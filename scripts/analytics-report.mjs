// 作者统计仅通过本机已有Cloudflare登录读取；不会把查询权限或玩家标识放进网页。
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ITEMS } from '../src/data/items.js';
import { ENDINGS } from '../src/data/endings.js';
const sql = `SELECT * FROM analytics_overview;
SELECT item_id,category,bought_quantity,refunded_quantity,buy_cost,refund_cost FROM analytics_shop_totals ORDER BY bought_quantity DESC;
SELECT * FROM analytics_event_totals ORDER BY started DESC;
SELECT * FROM analytics_endings ORDER BY total DESC;
SELECT * FROM analytics_role_difficulty;`;
let rows;
try {
  const out=execFileSync('wrangler',['d1','execute','DB','--remote','--json','--command',sql], {encoding:'utf8',env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'450b22761d9a7a6918352fd4800f53a9'},maxBuffer:8*1024*1024});
  rows=JSON.parse(out).map(x=>x.results||[]);
} catch(e) { console.error('无法读取作者统计。请确认Cloudflare登录和D1迁移已完成。'); process.exit(1); }
const esc=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const o=rows[0]?.[0]||{};
const stat=(label,value)=>`<article><small>${esc(label)}</small><strong>${esc(value)}</strong></article>`;
const table=(title,cols,data)=>`<section><h2>${esc(title)}</h2><div class="scroll"><table><thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${data.length?data.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${cols.length}">暂无参与统计的数据</td></tr>`}</tbody></table></div></section>`;
const avg=o.avg_unlocked_endings_per_device;
const active=o.avg_active_seconds_per_active_run;
const body=`<header><div class="eyebrow">AOTAI · AUTHOR ONLY · D1</div><h1>玩家统计 / 作者快照</h1><p>生成时间 ${esc(new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))}（北京时间）</p></header>
<div class="notice">仅统计默认开启或主动重新开启后成功上报的数据，不代表所有访问者；上线前的本地历史不回补。这里不展示浏览器编号、逐人行为或IP。</div>
<div class="stats">${stat('新开局次数',o.run_started??0)}${stat('继续行程次数',o.run_resumed??0)}${stat('统计参与设备',o.players??0)}${stat('已完成局数',o.ended_runs??0)}${stat('死亡次数',o.deaths??0)}${stat('平均已解锁结局 / 设备',avg==null?'暂无':Number(avg).toFixed(2))}${stat('平均可操作时长 / 活跃局',active==null?'暂无':`${(Number(active)/60).toFixed(1)} 分钟`)}</div>
${table('购买与退款（游戏内货币）',['道具','类别','购买数量','退款数量','购买金额','退款金额'],(rows[1]||[]).map(r=>[ITEMS[r.item_id]?.name||r.item_id,r.category,r.bought_quantity,r.refunded_quantity,r.buy_cost,r.refund_cost]))}
${table('事件漏斗',['事件ID','触发','完成'],(rows[2]||[]).map(r=>[r.event_id,r.started,r.completed]))}
${table('结局与死因',['结局','死因','次数'],(rows[3]||[]).map(r=>[r.ending === 'dead' ? '遇难' : ENDINGS[r.ending]?.title || r.ending,ENDINGS.dead[r.cause]?.title || r.cause || '—',r.total]))}
${table('身份与难度',['身份','难度','已观察局','新开局','已结束','死亡'],(rows[4]||[]).map(r=>[r.role,r.difficulty,r.observed_runs,r.fresh_runs,r.ended_runs,r.deaths]))}
<footer><p>口径：设备是随机浏览器编号，换设备或清缓存会重复计数。平均解锁结局分母为所有参与统计设备（含只在商店操作但未出发的设备），分子为每设备首次解锁主结局/死因的总数。可操作时长不含后台、暂停菜单、剧情和选后阅读；零活跃局不进入时长平均。</p><p>本页为本机私有快照，不部署到游戏站点。重新运行 <code>npm run stats</code> 可更新。完整视图与额度/保留策略见仓库文档。</p></footer>`;
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>鳌太作者统计</title><style>*{box-sizing:border-box}body{margin:0;background:#10171c;color:#d3d6cf;font:15px/1.6 ui-monospace,monospace;max-width:1120px;padding:32px 20px;margin:auto}h1{font-size:28px;margin:10px 0}h2{font-size:19px;margin:30px 0 12px}.eyebrow,small,footer{color:#9ca89f}.notice{padding:14px;border-left:3px solid #d0ae61;background:#1c2427}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-top:20px}article{border:1px solid #344148;padding:16px}article small{display:block}strong{display:block;font-size:25px;color:#e6ca8b}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #344148}th{font-size:12px;color:#b1bcb4}.scroll{overflow:auto}footer{margin-top:32px;font-size:12px;border-top:1px solid #344148}code{color:#e6ca8b}</style>${body}</html>`;
mkdirSync('output',{recursive:true});writeFileSync('output/analytics-report.html',html);
console.log('已更新 output/analytics-report.html；不含玩家标识，仅供作者本机打开。');
