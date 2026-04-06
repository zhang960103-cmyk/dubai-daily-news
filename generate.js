#!/usr/bin/env node
/**
 * 迪拜今日报 - Auto-Generator
 * Runs in GitHub Actions: Node.js 20, open internet
 * Called by .github/workflows/daily.yml
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY not set'); process.exit(1); }

// Dubai = UTC+4
const dubaiNow = new Date(Date.now() + 4 * 3600 * 1000);
const month = dubaiNow.getUTCMonth() + 1;
const day   = dubaiNow.getUTCDate();
const year  = dubaiNow.getUTCFullYear();
const ds    = `${month}月${day}日`;
const dsEn  = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

const args = process.argv.slice(2);
const editions = args.length ? args : ['morning','evening'];

console.log(`🏙️  迪拜今日报 Auto-Generator`);
console.log(`📅 Dubai Date: ${dsEn} (${ds})`);
console.log(`📰 Editions: ${editions.join(', ')}`);

// ── HTTP helper ───────────────────────────────────────────
function httpPost(payload, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      }
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${json?.error?.message || JSON.stringify(json).slice(0,100)}`));
          } else {
            resolve(json);
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`Timeout after ${timeoutMs}ms`)); });
    req.write(body);
    req.end();
  });
}

// ── Parse JSON from AI response ───────────────────────────
function extractJSON(apiResp) {
  const allText = (apiResp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  // Strip markdown fences (``` or ```json)
  let txt = allText.replace(/^```[a-z]*\r?\n?/im, '').replace(/\r?\n?```\s*$/m, '').trim();

  // Find outermost JSON object
  const start = txt.indexOf('{');
  const end   = txt.lastIndexOf('}') + 1;
  if (start < 0 || end <= start) {
    throw new Error(`No JSON object found. Response: ${allText.slice(0, 300)}`);
  }
  return JSON.parse(txt.slice(start, end));
}

// ── Build prompt ──────────────────────────────────────────
function buildPrompt(edition) {
  const isMorning = edition === 'morning';
  const timeLabel = isMorning ? '早安' : '夜读';
  const focus = isMorning
    ? '今天出门前必须知道的事：政策福利、出行信息、战事简报、风险预警'
    : '今天全天复盘：市场数据、战事汇总、深度分析、明日预判';

  return `请搜索今日阿联酋迪拜最新新闻（${dsEn}），为迪拜华人生成${timeLabel}简报。

搜索关键词：
1. "UAE Dubai news ${dsEn}"
2. "Dubai government announcement ${dsEn}"  
3. "Middle East war conflict ${dsEn} casualties"
4. "Dubai RTA MOE DEWA police ${dsEn}"

【核心定位】${focus}

【选稿标准 - 严格执行】
✅ 战事（必选）：具体交战方+地点+今日进展+数字，不能笼统
✅ ${isMorning ? '政策福利（必选）：UAE机构今日公告/免费服务/优惠政策，含机构名和时间' : '市场数据（必选）：今日UAE或国际市场关键数据，含具体数字'}
✅ 本地民生：直接影响迪拜居民日常生活的信息
✅ 风险预警：诈骗/法律变化/安全事故（真实事件）
✅ 负面新闻同等重要，不回避
❌ 禁止笼统标题（如"迪拜经济持续增长"无数字则不写）
❌ 禁止虚假信息，不确定的不写

每条标题必须包含：具体数字/机构名/人名/地名/金额

只返回纯JSON，不要用\`\`\`包裹，不要任何其他文字：
{
  "date": "${ds}",
  "date_en": "${dsEn}",
  "edition": "${edition}",
  "ready": true,
  "generated_at": "${new Date().toISOString()}",
  "news": [
    {"emoji":"⚔️","category":"战事","title":"【交战方】今日对【地点】【具体行动】，X人伤亡","summary":"战况对迪拜能源/海运/汇率实际量化影响，35字内","source":"来源媒体","hot":true},
    {"emoji":"${isMorning?'🎁':'📊'}","category":"${isMorning?'政策福利':'商业'}","title":"${isMorning?'【机构名】宣布【具体政策/活动/金额/时间】':'【行业/指标】今日数据：X（含同比数字）'}","summary":"35字内","source":"来源媒体","hot":${isMorning?'true':'false'}},
    {"emoji":"🚦","category":"本地生活","title":"今日迪拜【具体区域/设施/活动】信息","summary":"35字内","source":"来源媒体","hot":false},
    {"emoji":"⚠️","category":"风险预警","title":"【机构】警告：【具体诈骗/法律/安全事件】","summary":"防范方法35字内","source":"来源媒体","hot":false},
    {"emoji":"🏙️","category":"房产","title":"【区域/楼盘】${isMorning?'成交/政策':'今日成交'}（含具体数字）","summary":"35字内","source":"来源媒体","hot":false},
    {"emoji":"${isMorning?'💼':'🎓'}","category":"${isMorning?'商业':'教育'}","title":"【具体公司/机构】【事件+数字】","summary":"35字内","source":"来源媒体","hot":false}
  ],
  "zhishi": [
    "${isMorning?'【政策操作】今日最值得华人行动的政策/福利完整操作指引（含时间地点申请方式），60字':'【今日复盘】今天最重要事件的背景和深层逻辑，适合深度思考，60字'}",
    "【战事影响】此次冲突对迪拜能源价格/物流成本/汇率的具体量化影响，60字",
    "${isMorning?'【早间必做】今天出门前最应做的一件具体事及步骤，60字':'【明日预判】基于今日信息，明天值得重点关注的具体事项及原因，60字'}"
  ],
  "ruiping": "${isMorning?'早安锐评：今日最值得关注的矛盾或机遇，直接点，不废话，华人视角，70字':'夜读锐评：今日最值得深思的一件事，有立场有温度，迪拜华人视角，睡前反思，80字'}",
  "money_tips": [
    "💡【${isMorning?'今日行动':'今日信号'}】${isMorning?'今天就能做的具体事含操作步骤':'今天最重要的经济或政策信号华人如何利用'}，40字",
    "💡【${isMorning?'规避坑':'明日行动'}】${isMorning?'今日需警惕的具体风险或法律边界':'基于今日复盘明天应做的具体事'}，40字",
    "💡【${isMorning?'布局信号':'长线机会'}】今日信息透露的${isMorning?'3-6':'6-12'}个月内机会或风险，40字"
  ]
}`;
}

// ── Generate one edition ───────────────────────────────────
async function generateEdition(edition) {
  console.log(`\n📰 Generating ${edition} edition...`);

  const response = await httpPost({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: buildPrompt(edition) }]
  }, 180000);

  console.log(`  stop_reason: ${response.stop_reason}`);
  console.log(`  content types: [${(response.content||[]).map(b=>b.type).join(', ')}]`);

  const data = extractJSON(response);
  data.ready = true;
  data._edition = edition;
  data.generated_at = new Date().toISOString();

  const outPath = path.join(__dirname, 'data', `${edition}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');

  const newsCount = data.news?.length || 0;
  console.log(`  ✅ Saved ${edition}.json — ${newsCount} news items`);
  (data.news || []).forEach((n, i) => {
    console.log(`    ${i+1}. [${n.category}] ${n.title}`);
  });
  return data;
}

// ── Main ──────────────────────────────────────────────────
(async () => {
  let anyFailed = false;
  for (const ed of editions) {
    try {
      await generateEdition(ed);
    } catch(e) {
      console.error(`\n❌ Failed ${ed}: ${e.message}`);
      // Write error placeholder so site can show message
      fs.writeFileSync(
        path.join(__dirname, 'data', `${ed}.json`),
        JSON.stringify({
          ready: false,
          error: e.message,
          date: ds, date_en: dsEn, edition: ed,
          generated_at: new Date().toISOString(),
          news: [], zhishi: [], ruiping: '', money_tips: []
        }, null, 2)
      );
      anyFailed = true;
    }
  }
  if (anyFailed) process.exit(1);
  console.log('\n✅ Done!');
})();
