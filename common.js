/* Shared pure rules and DOM helpers. No page text is executed. */
(() => {
  if (globalThis.CM?.version === '3.1.1') return;
  const text=x=>String(x?.textContent??x??'').replace(/\s+/g,' ').trim();
  const norm=x=>text(x).normalize('NFKC').toLowerCase().replace(/\s+/g,' ');
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const all=(sel,root=document)=>[...root.querySelectorAll(sel)];
  const visible=e=>!!e?.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
  function target(value,base='https://rpd.factset.com/') {
    try {
      const u=new URL(value,base);if(u.protocol!=='https:')return null;
      if(u.hostname==='rpd.factset.com' && /\/summary\.aspx$/i.test(u.pathname)) {
        const id=[...u.searchParams].find(([k])=>k.toLowerCase()==='messageid')?.[1];
        if(/^\d+$/.test(id||''))return {key:`RPD:${id}`,source:'RPD',id,url:`https://rpd.factset.com/summary.aspx?messageid=${id}`};
      }
      if(u.hostname==='factset.lightning.force.com') {
        const id=u.pathname.match(/\/Case\/(500[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?)(?:\/|$)/)?.[1];
        if(id)return {key:`Salesforce:${id.slice(0,15)}`,source:'Salesforce',id,url:`https://factset.lightning.force.com/lightning/r/Case/${id}/view`};
      }
    }catch{}return null;
  }
  function links(root,base=globalThis.location?.href) {
    if(!root)return [];
    const found=new Map();
    for(const a of all('a[href]',root)){const t=target(a.getAttribute('href'),base);if(t)found.set(t.key,{...t,label:text(a)});}
    return [...found.values()];
  }
  // Only a short explicitly labelled relation, never every case URL in a page.
  function explicitLinks(root,base=globalThis.location?.href) {
    const found=new Map();if(!root)return [];
    for(const block of all('p,li,div',root).filter(e=>!e.querySelector('p,li,div'))) {
      const raw=text(block);
      if(!/\b(?:spin[\s-]*off|spinning off|duplicate of|linked (?:case|rpd))\b/i.test(raw)||raw.length>900)continue;
      for(const t of links(block,base))found.set(t.key,t);
      for(const m of raw.matchAll(/https:\/\/[^\s<>"']+/gi)){const t=target(m[0].replace(/[.,;)]+$/,''),base);if(t)found.set(t.key,t);}
      for(const m of raw.matchAll(/\bRPD\s*[:#]\s*(\d{7,12})\b/gi)){const t=target(`https://rpd.factset.com/summary.aspx?messageid=${m[1]}`);found.set(t.key,t);}
    }return [...found.values()];
  }
  function scroller(el) {
    for(let p=el;p;p=p.parentElement){if(p.scrollHeight>p.clientHeight+5 && (p.dataset?.isScrollable==='true'||/(auto|scroll)/.test(getComputedStyle(p).overflowY)))return p;}
    return document.scrollingElement||document.documentElement;
  }
  async function cancelled(){if((await chrome.storage.local.get('monitorStopRequested')).monitorStopRequested)throw new Error('Run stopped.');}
  async function waitFor(fn,timeout=20000) {
    const end=Date.now()+timeout;while(Date.now()<end){await cancelled();const v=fn();if(v)return v;await sleep(250);}throw new Error('Page elements did not load. Check sign-in and case access.');
  }
  async function expand(root,pattern,limit=60) {
    const clicked=new WeakSet();
    for(let i=0;i<limit;i++){await cancelled();const b=all('a,button,[role="button"]',root).find(e=>visible(e)&&!e.disabled&&!clicked.has(e)&&pattern.test(text(e)||e.title||e.getAttribute('aria-label')||''));if(!b)return;clicked.add(b);b.click();await sleep(250);}
  }
  function stamp(x){const t=Date.parse(x);return Number.isFinite(t)?t:null;}
  function latest(messages) {
    if (!messages.length) return null;
    const dated=messages.map(message=>({message,time:stamp(message.date)}));
    if(dated.some(entry=>entry.time===null))return null;
    const newest=Math.max(...dated.map(entry=>entry.time));
    const candidates=dated.filter(entry=>entry.time===newest).map(entry=>entry.message);
    if(candidates.some(message=>!text(message.author)))return null;
    const identities=new Set(candidates.map(m=>[m.author,m.authorId||'',m.authorType||''].join('|')));
    return identities.size===1?candidates[0]:null;
  }
  function caseNumber(item) {
    for(const value of [item.caseNumber,item.label]) {
      const raw=text(value);
      const match=raw.match(/^(\d{5,12})$/)||raw.match(/^(\d{5,12})\s*\|\s*Case\b/i)||raw.match(/^(?:Salesforce|SF|Case)\s*(?:Case\s*)?[#:]?\s*(\d{5,12})\b/i);
      if(match)return match[1];
    }
    return '';
  }
  function identity(message,settings) {
    const a=norm(message?.author);if(message?.authorType==='client')return 'CLIENT';
    if(!a||/^(unknown|system|case systems process)$/.test(a))return 'UNKNOWN';
    const vals=[a,norm(message.authorEmail),norm(message.authorId)].filter(Boolean);
    const match=p=>[p.name,p.ownerAlias,p.email,p.employeeId].filter(Boolean).some(v=>vals.includes(norm(v)));
    if(match({name:settings.rpdName,ownerAlias:settings.salesforceAlias}))return 'ME';
    if((settings.myTeam||[]).some(match))return 'TEAM';return 'OTHER';
  }
  function classify(item,settings,now=Date.now()) {
    const senderType=identity(item.latest,settings),date=stamp(item.latest?.date),ageDays=date===null?null:Math.max(0,(now-date)/86400000);
    // Use the CURRENT status field, never a historical 'resolved' comment.
    if(item.source==='RPD'&&norm(item.status)==='resolved')return {group:'recentlyHandled',senderType,ageDays,finished:true,reason:'Finished / Resolved — no case action needed.'};
    if(item.error||!item.latest||senderType==='UNKNOWN'||date===null)return {group:'unclassified',senderType,ageDays,reason:item.error||'Latest message author or time could not be verified.'};
    if(senderType==='CLIENT')return {group:'needsAttention',senderType,ageDays,reason:'IMMEDIATE: the client wrote the latest message.'};
    if(senderType==='OTHER')return {group:'needsAttention',senderType,ageDays,reason:'The latest author is outside your configured team.'};
    if(ageDays>=7)return {group:'stale',senderType,ageDays,reason:'Team last replied at least 7 days ago; follow-up is due.'};
    if(senderType==='ME')return {group:'recentlyHandled',senderType,ageDays,reason:'You wrote the latest message.'};
    return {group:'waiting',senderType,ageDays,reason:'Your teammate wrote the latest message; no new outside reply.'};
  }
  globalThis.CM={version:'3.1.1',text,norm,sleep,all,visible,target,links,explicitLinks,scroller,cancelled,waitFor,expand,stamp,latest,caseNumber,identity,classify};
})();
