#!/usr/bin/env node
/**
 * 迪拜今日报 - 自动生成脚本
 * 运行环境: GitHub Actions (Node.js)
 * 功能: 调用 Anthropic API + web_search，生成早/晚新闻 JSON
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) { console.error('❌ ANTHROPIC_API_KEY not set'); process.exit(1); }

// Dubai time = UTC+4
const now = new Date();
const dubaiHour = (now.getUTCHours() + 4) % 24;
const dubaiDate = new Date(now.getTime() + 4 * 60 * 60 * 1000);
const month = dubaiDate.getUTCMonth() + 1;
const day = dubaiDate.getUTCDate();
const year = dubaiDate.getUTCFullYear();
const ds = `${month}月${day}日`;
const dsEn = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

// Determine which editions to generate based on time
// 2am UTC = 6am Dubai → morning
// 5pm UTC = 9pm Dubai → evening
const args = process.argv.slice(2);
const editions = args.includes('morning') ? ['morning']
               : args.includes('evening') ? ['evening']
               : ['morning', 'evening']; // default: both

console.log(`🕐 Dubai time: ${dubaiHour}:00 | Generating: ${editions.join(', ')}`);

// ── HTTP helper ──────────────────────────────────────────
function callAPI(payload) {
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
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(json?.error)}`));
          } else {
            resolve(json);
          }
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Extract JSON from API response ───────────────────────
function extractJSON(apiResponse) {
  const txt = (apiResponse.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .replace(/^```[a-z]*\n?/im, '')
    .replace(/\n?```$/m, '')
    .trim();

  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON found in response:\n' + txt.slice(0, 300));
  return JSON.parse(m[0]);
}

// ── MORNING PROMPT ───────────────────────────────────────
function morningPrompt() {
  return `Search the web for today's UAE and Dubai news (${dsEn}), then generate a Chinese-language morning briefing for Chinese residents in Dubai.

Please search for:
- "Dubai UAE news ${dsEn}"  
- "UAE government ministry announcement ${dsEn}"
- "Middle East war conflict ${dsEn}"
- "Dubai police RTA DEWA announcement ${dsEn}"

SELECTION RULES (strictly follow):
1. MUST include: Middle East war/conflict with SPECIFIC details (parties, location, casualty numbers, latest development)
2. MUST include: UAE government policy/benefit/free event for residents (MOE free market stalls, RTA new rules, visa policy, DEWA discounts etc)
3. Include: Today's practical info (weather alert, traffic, events, health notices)
4. Include: Property market news with specific numbers/areas
5. Include: Risk warning (scam alert, legal change, safety notice)
6. Be objective, include negative news, do not sugarcoat
7. Every title MUST have specific: numbers, names, districts, amounts - NEVER vague

Return ONLY valid JSON (no markdown, no backticks, no explanation):
{
  "ready": true,
  "generated_at": "${new Date().toISOString()}",
  "date": "${ds}",
  "date_en": "${dsEn}",
  "edition": "morning",
  "news": [
    {"emoji":"⚔️","category":"战事","title":"具体交战方+地点+今日最新进展含数字","summary":"核心战况及对迪拜能源/海运/汇率实际影响，35字","source":"媒体名","hot":true},
    {"emoji":"🎁","category":"政策福利","title":"机构名+具体政策活动名+时间金额","summary":"受益对象、具体内容、如何参与，35字","source":"媒体名","hot":true},
    {"emoji":"🚦","category":"本地生活","title":"今日出行/天气/活动/安全提示（具体路段或活动名）","summary":"35字内具体信息","source":"媒体名","hot":false},
    {"emoji":"🏙️","category":"房产","title":"具体区域+数据或政策","summary":"35字","source":"媒体名","hot":false},
    {"emoji":"⚠️","category":"风险预警","title":"具体诈骗/法律/安全风险事件","summary":"35字，含如何防范","source":"媒体名","hot":false},
    {"emoji":"💼","category":"商业","title":"具体公司/行业+数据","summary":"35字","source":"媒体名","hot":false}
  ],
  "zhishi": [
    "【政策解读】今日最重要政策/活动的完整操作指引，含申请方式、时间地点、适用人群，60字",
    "【战事深度】此轮冲突的根源、当前局势、对迪拜能源价格/物流成本/人民币汇率的量化影响，60字",
    "【早间必做】今日迪拜华人最应立即行动的一件事及理由，60字"
  ],
  "ruiping": "早安锐评：直接点出今日最值得关注的矛盾或机遇，不绕弯子，迪拜华人视角，70字",
  "money_tips": [
    "💡【今日机会】基于今日新闻最值得今天就行动的具体事项，40字",
    "💡【风险规避】今日需要注意的具体坑或法律风险，40字",
    "💡【布局信号】今日新闻透露的中期投资或商业机会，40字"
  ]
}`;
}

// ── EVENING PROMPT ────────────────────────────────────────
function eveningPrompt() {
  return `Search the web for today's UAE and Dubai news recap (${dsEn}), then generate a Chinese-language evening briefing for Chinese residents in Dubai.

Please search for:
- "Dubai UAE news today ${dsEn}"
- "Dubai economy business market ${dsEn}"
- "Middle East conflict war update ${dsEn}"
- "UAE law regulation change ${dsEn}"

SELECTION RULES:
1. Recap what actually happened today - most important events with specifics
2. Market/economic data from today (oil price, DXB property transactions, business news)
3. War/conflict: full day summary with specific numbers
4. Any new law, policy or regulation announced today
5. Community-relevant: expat life, school, healthcare news
6. Must include negative news - do not filter out criticism or problems
7. Every title: specific numbers, names, locations, amounts

Return ONLY valid JSON (no markdown, no backticks):
{
  "ready": true,
  "generated_at": "${new Date().toISOString()}",
  "date": "${ds}",
  "date_en": "${dsEn}",
  "edition": "evening",
  "news": [
    {"emoji":"⚔️","category":"战事","title":"今日战场全天汇总含具体伤亡数字和进展","summary":"今日最重要战事全天进展，35字","source":"媒体名","hot":true},
    {"emoji":"📊","category":"商业","title":"今日市场/行业数据含具体数字","summary":"35字","source":"媒体名","hot":false},
    {"emoji":"🏙️","category":"房产","title":"今日成交/政策/项目动态含数字","summary":"35字","source":"媒体名","hot":false},
    {"emoji":"🎓","category":"教育","title":"KHDA/MOE/学校今日动态","summary":"35字","source":"媒体名","hot":false},
    {"emoji":"🌆","category":"本地生活","title":"今日民生热点（物价/服务/活动）","summary":"35字","source":"媒体名","hot":false},
    {"emoji":"⚠️","category":"风险预警","title":"今日曝出的风险/负面/法律变化","summary":"35字","source":"媒体名","hot":false}
  ],
  "zhishi": [
    "【今日复盘】今天最重要事件的背景和深层逻辑，适合深度思考，60字",
    "【明日预判】基于今日新闻，明天值得重点关注的事项，60字",
    "【数据解读】今日最重要经济数据的含义及对华人居民的实际影响，60字"
  ],
  "ruiping": "夜读锐评：今日最值得深思的一件事，有立场有温度，适合睡前反思，迪拜华人视角，80字",
  "money_tips": [
    "💡【今日信号】今天最重要的经济或政策信号，对华人的启示，40字",
    "💡【明日行动】基于今日复盘，明天应该具体做的一件事，40字",
    "💡【中长期】今日新闻透露的3-12个月内的机会或风险，40字"
  ]
}`;
}

// ── GENERATE ONE EDITION ──────────────────────────────────
async function generateEdition(editionName) {
  console.log(`\n📰 Generating ${editionName} edition...`);
  const prompt = editionName === 'morning' ? morningPrompt() : eveningPrompt();

  const response = await callAPI({
    model: 'claude-sonnet-4-6', // Use Sonnet for better quality
    max_tokens: 3000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: prompt }]
  });

  console.log(`  stop_reason: ${response.stop_reason}`);
  console.log(`  content blocks: ${(response.content||[]).map(b=>b.type).join(', ')}`);

  const data = extractJSON(response);
  data.ready = true;
  data.generated_at = new Date().toISOString();
  data._edition = editionName;

  const outPath = path.join(__dirname, 'data', `${editionName}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`  ✅ Saved to data/${editionName}.json (${JSON.stringify(data).length} chars)`);
  console.log(`  📍 ${data.news?.length || 0} news items`);
  data.news?.forEach((n, i) => console.log(`    ${i+1}. [${n.category}] ${n.title}`));
  return data;
}

// ── MAIN ─────────────────────────────────────────────────
(async () => {
  console.log(`\n🏙️ 迪拜今日报 Auto-Generator`);
  console.log(`📅 Date: ${dsEn} (${ds})`);
  console.log(`🔑 API key: ${API_KEY.slice(0,20)}...`);

  for (const ed of editions) {
    try {
      await generateEdition(ed);
    } catch (e) {
      console.error(`❌ Failed to generate ${ed}:`, e.message);
      // Write error state so page knows generation failed
      const errData = {
        ready: false,
        error: e.message,
        generated_at: new Date().toISOString(),
        date: ds,
        edition: ed,
        news: [], zhishi: [], ruiping: '', money_tips: []
      };
      fs.writeFileSync(
        path.join(__dirname, 'data', `${ed}.json`),
        JSON.stringify(errData, null, 2)
      );
      process.exit(1);
    }
  }
  console.log('\n✅ All done!');
})();
