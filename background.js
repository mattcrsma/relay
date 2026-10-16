importScripts('common.js');
const C=CM;
let busy=false,starting=false,deliveryController=null;
// Personal configuration is entered in Settings, never committed to GitHub.
const defaults = {
  rpdName: '',
  salesforceAlias: '',
  powerAutomateUrl: '',
  myTeam: []
};
async function loadSettings() {
  return chrome.storage.local.get(defaults);
}
const own=sender=>{
  if(sender.id!==chrome.runtime.id||!sender.url)return false;
  try{const u=new URL(sender.url);u.search='';u.hash='';return ['popup.html','options.html'].some(page=>u.href===chrome.runtime.getURL(page));}catch{return false;}
};
const readJob=async()=> (await chrome.storage.local.get('cmJob')).cmJob;
async function saveJob(job,progress) {
  await chrome.storage.local.set({cmJob:job,monitorIsRunning:job.status==='running',monitorProgress:progress||''});
}
async function ready(tabId) {
  const end=Date.now()+45000;
  while(Date.now()<end) {
    await C.cancelled();
    const t=await chrome.tabs.get(tabId);
    if(t.status==='complete')return;
    await C.sleep(400);
  }
  throw new Error('Case page load timed out.');
}
async function reloadAndWait(tabId) {
  await C.cancelled();
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });

  // A tab can say "complete" while still showing its previous document.
  // Capture Chrome's document ID so that the old page can never pass.
  const before = await chrome.scripting.executeScript({
    target: { tabId },
    injectImmediately: true,
    func: () => document.readyState
  });
  const oldDocumentId = before[0]?.documentId;
  if (!oldDocumentId) {
    throw new Error('Relay could not identify the page before refreshing. Nothing was read.');
  }

  const host = new URL(tab.url).hostname;
  const site = host === 'factset.sharepoint.com' ? 'SharePoint'
    : host === 'rpd.factset.com' ? 'RPD' : 'Salesforce';
  await chrome.storage.local.set({
    monitorProgress: `Refreshing ${site} — waiting for a new page document…`
  });
  await chrome.tabs.reload(tabId, { bypassCache: true });

  const deadline = Date.now() + 60000;
  let readySince = 0;
  let newDocumentId = '';
  let lastIssue = 'The old page is still present.';
  while (Date.now() < deadline) {
    await C.cancelled();
    // A closed tab fails immediately instead of silently reading another tab.
    const current = await chrome.tabs.get(tabId);
    if (current.status !== 'complete') {
      readySince = 0;
      await C.sleep(400);
      continue;
    }

    let probe;
    try {
      [probe] = await chrome.scripting.executeScript({
        target: { tabId },
        injectImmediately: true,
        func: () => {
          const visible = element => {
            const style = getComputedStyle(element);
            return element.getClientRects().length > 0 &&
              style.display !== 'none' && style.visibility !== 'hidden';
          };
          const anyVisible = selector =>
            [...document.querySelectorAll(selector)].some(visible);
          const host = location.hostname;
          let contentReady = false;
          if (host === 'factset.sharepoint.com') {
            contentReady = anyVisible('#list-content-id [role="row"][data-automationid^="row-"]');
          } else if (host === 'rpd.factset.com') {
            contentReady = anyVisible('.reply .replyHeader');
          } else if (host === 'factset.lightning.force.com') {
            // The Salesforce reader will then select Feed and expand/scroll it.
            contentReady = anyVisible('.cuf-feed[data-feed-type="Record"]') ||
              [...document.querySelectorAll('[role="tab"]')].some(element =>
                visible(element) && element.textContent.trim() === 'Feed');
          }
          const busy = anyVisible('[aria-busy="true"], [role="progressbar"], .slds-spinner');
          return { complete: document.readyState === 'complete', contentReady, busy };
        }
      });
    } catch (error) {
      // Script contexts can disappear while redirects/reloads are in progress.
      lastIssue = error.message;
      readySince = 0;
      await C.sleep(400);
      continue;
    }

    if (!probe?.documentId || probe.documentId === oldDocumentId) {
      lastIssue = 'Chrome has not replaced the old page document.';
      readySince = 0;
    } else if (!probe.result?.complete || !probe.result.contentReady || probe.result.busy) {
      lastIssue = 'The refreshed page is still loading its case/list content. Check sign-in and access.';
      readySince = 0;
    } else {
      if (newDocumentId !== probe.documentId) {
        newDocumentId = probe.documentId;
        readySince = 0;
      }
      if (!readySince) readySince = Date.now();
      // Require two seconds of consecutive ready checks, not a fixed blind delay.
      if (Date.now() - readySince >= 2000) {
        await C.cancelled();
        console.info('[Relay refresh verified]', { site, tabId, oldDocumentId, newDocumentId });
        await chrome.storage.local.set({
          monitorProgress: `Refresh verified — reading ${site}…`
        });
        return;
      }
    }
    await C.sleep(400);
  }
  throw new Error(`${site} refresh was not verified; reading was skipped. ${lastIssue}`);
}
async function ensureReader(tabId,file) {
  // Also supports tabs that were already open when the extension was reloaded.
  await chrome.scripting.executeScript({target:{tabId},files:['common.js',file]});
}
async function sharepoint(settings) {
  const tabs=await chrome.tabs.query({url:'https://factset.sharepoint.com/*'});
  const lists=tabs.filter(t=>/\/Lists\//i.test(t.url||''));
  const candidates=lists.length?lists:tabs;
  const active=candidates.filter(t=>t.active);
  const chosen=active.length===1?active[0]:candidates.length===1?candidates[0]:null;
  if(!chosen)throw new Error(candidates.length?'Activate the SharePoint case list you want to scan, or close extra SharePoint list tabs.':'Open your SharePoint case list and sign in first.');
  await chrome.windows.update(chosen.windowId,{focused:true});
  await chrome.tabs.update(chosen.id,{active:true});
  await reloadAndWait(chosen.id);
  const result=await executeReader(chosen.id,'sharepoint.js','sharepoint',settings);
  return result;
}
async function executeReader(tabId,file,name,expected) {
  await ensureReader(tabId,file);
  const results=await chrome.scripting.executeScript({target:{tabId},func:async(name,expected)=>{
    try{return {success:true,data:await globalThis.CMReaders[name].read(expected)};}
    catch(e){return {success:false,error:e.message};}
  },args:[name,expected]});
  const response=results[0]?.result;
  if(!response?.success)throw new Error(response?.error||'Case document changed during the read.');
  return response.data;
}
function caseNumberFor(item,job) {
  if(item.source!=='Salesforce')return item.id||'';
  const rows=(job.sharepoint||[]).filter(row=>row.primary?.key===item.key);
  return C.caseNumber(item)||rows.map(row=>C.caseNumber(row.primary)||C.caseNumber({label:row.title})).find(Boolean)||'';
}
function caseLabel(item,job) {
  if(item.source!=='Salesforce')return `${item.source} ${item.id}`;
  const number=caseNumberFor(item,job);
  return number?`Salesforce ${number}`:'Salesforce (number unavailable)';
}
async function cleanupTabs(job) {
  for(const [key,id] of Object.entries(job.scanTabs||{})) {
    try{const tab=await chrome.tabs.get(id);if(C.target(tab.url)?.key===key)await chrome.tabs.remove(id);}catch{}
    delete job.scanTabs[key];
  }
}
async function detail(task,job) {
  // Reuse only an exact matching case URL, including Salesforce 15/18 character IDs.
  const matches=(await chrome.tabs.query({})).filter(t=>
    C.target(t.pendingUrl||t.url)?.key===task.key);
  matches.sort((a,b)=>Number(b.windowId===job.windowId)-Number(a.windowId===job.windowId)||Number(b.active)-Number(a.active));
  let tab=matches[0];
  if(!tab){
    tab=await chrome.tabs.create({url:task.url,windowId:job.windowId,active:true});
    // Only tabs created by this run may be closed during cleanup.
    job.scanTabs||={};job.scanTabs[task.key]=tab.id;
  }

  let last;
  try {
    await saveJob(job,`Reading ${caseLabel(task,job)}`);
    for(let attempt=0;attempt<3;attempt++) {
      await C.cancelled();
      try {
        await chrome.windows.update(tab.windowId,{focused:true});
        await chrome.tabs.update(tab.id,{active:true});
        await reloadAndWait(tab.id);await C.sleep(1000+attempt*1000);
        const actual=await chrome.tabs.get(tab.id);
        if(C.target(actual.url)?.key!==task.key)throw new Error('Case page redirected. Check sign-in or access.');
        const isRpd=task.source==='RPD';
        const data=await executeReader(tab.id,isRpd?'rpd.js':'salesforce.js',isRpd?'rpd':'salesforce',task);
        if(data.key!==task.key)throw new Error('Reader returned a different case.');
        return {...task,...data,caseNumber:data.caseNumber||caseNumberFor(task,job)};
      }catch(e){last=e;if(attempt<2)await C.sleep(1200);}
    }
    return {...task,caseNumber:caseNumberFor(task,job),error:last?.message||'Could not read case.',messages:[],latest:null,warnings:[last?.message||'Could not read case.']};
  } finally {
    await cleanupTabs(job);
  }
}
function add(job,target,parent,title='') {
  if(!target)return;
  let item=job.queue.find(t=>t.key===target.key);
  if(!item) {item={...target,title,parents:[]};job.queue.push(item);}
  if(parent && !item.parents.includes(parent))item.parents.push(parent);
}
const headings={needsAttention:'🚨 **Likely Needs Attention**',stale:'⏰ **Stale / Follow-up (7+ days)**',waiting:'⏳ **Waiting on Others**',recentlyHandled:'✅ **Recently Handled**'};
const safe=s=>C.text(s).replace(/[\[\]*_`<>|]/g,' ');
function report(job,items) {
  const groups={needsAttention:[],stale:[],waiting:[],recentlyHandled:[],unclassified:[]};
  const lookup=new Map([...job.queue,...items].map(item=>[item.key,item]));
  const link=item=>`[${safe(caseLabel(item,job))}](${C.target(item.url)?.url||''})`;
  const date=value=>{
    if(!value||!Number.isFinite(Date.parse(value)))return 'Time unavailable';
    return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
  };
  const parents=item=>[...new Set(item.parents||[])].filter(key=>!key.startsWith('SP:')).map(key=>lookup.get(key)).filter(Boolean);
  const relation=item=>{
    const from=parents(item);
    const assigned=job.sharepoint.some(row=>row.primary?.key===item.key);
    return [assigned?'Your SharePoint assignment':'Related case',from.length?'Related to: '+from.map(link).join(', '):''].filter(Boolean).join(' — ');
  };
  const reason=item=>{
    const a=item.attention;
    if(a.finished)return safe(a.reason);
    if(a.group==='unclassified')return 'Check manually: '+safe(a.reason);
    if(a.senderType==='CLIENT')return 'Client replied — immediate attention';
    if(a.group==='needsAttention')return 'Outside your team replied — review needed';
    if(a.group==='stale')return `No new reply for ${Math.floor(a.ageDays)} days — follow up`;
    return a.senderType==='ME'?'You replied last':'Your teammate replied last';
  };
  for(const item of items)groups[item.attention.group].push(item);
  groups.needsAttention.sort((a,b)=>(a.attention.senderType==='CLIENT'?0:1)-(b.attention.senderType==='CLIENT'?0:1));
  const checked=date(new Date().toISOString());
  const intro=`${job.sharepoint.length} SharePoint assignments · ${items.length} case pages checked · ${items.filter(i=>i.attention.finished).length} finished · ${groups.unclassified.length} need manual checking`;
  const lines=['📋 Relay Case Review',`Checked: ${checked} (UTC+8)`,intro];
  const sections=job.full?Object.keys(headings):['needsAttention','stale'];
  if(groups.unclassified.length)sections.unshift('unclassified');
  // ColumnSets work in Teams Adaptive Cards; Markdown pipe tables do not.
  const text=(value,bold=false)=>({type:'TextBlock',text:value||'—',wrap:true,...(bold?{weight:'Bolder'}:{})});
  const columns=values=>({type:'ColumnSet',separator:true,columns:values.map((value,index)=>({type:'Column',width:index===0?2:3,items:[text(value)]}))});
  const cards=[];
  const card=(title,body)=>({$schema:'https://adaptivecards.io/schemas/adaptive-card.json',type:'AdaptiveCard',version:'1.2',msteams:{width:'Full'},body:[text('📋 Relay Case Review',true),text(`Checked: ${checked} (UTC+8)`),text(intro),text(title,true),...body]});
  for(const group of sections) {
    const title=group==='unclassified'?'⚠ Needs manual checking':headings[group].replaceAll('**','');
    lines.push('',`${title} (${groups[group].length})`,'');
    if(!groups[group].length){lines.push('None.');cards.push(card(title,[text('None.')]));continue;}
    let rows=[];
    for(const item of groups[group]) {
      const author=safe(item.latest?.author||'Author unavailable');
      const when=date(item.latest?.date);
      lines.push(link(item),`Latest reply: ${author} · ${when}`,`Action: ${reason(item)}`,relation(item));
      if(item.warnings?.length)lines.push('Read warning: '+safe(item.warnings.join(' ')));
      lines.push('');
      rows.push(columns([link(item),`${author}\n\n${when}\n\n${reason(item)}`,relation(item)]));
    }
    // Limit rows and byte size so larger reports can be posted as ordered cards.
    let part=[];
    const header=columns(['**Case**','**Latest reply / action**','**Assignment / related main case**']);
    for(const row of rows){
      if(part.length&&(part.length>=10||new TextEncoder().encode(JSON.stringify(card(title,[header,...part,row]))).length>23000)){
        cards.push(card(title,[header,...part]));part=[];
      }
      part.push(row);
    }
    if(part.length)cards.push(card(title,[header,...part]));
  }
  const warnings=[...new Set(job.warnings||[])];
  if(warnings.length){
    lines.push('','⚠ Read warnings','',...warnings.map(w=>'- '+safe(w)));
    for(let i=0;i<warnings.length;i+=10)cards.push(card('⚠ Read warnings',warnings.slice(i,i+10).map(w=>text(safe(w)))));
  }
  // HTML tables for the Teams "Post a message in a chat or channel" action.
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const htmlLink=item=>{
    const target=C.target(item.url);
    return target?`<a href="${escape(target.url)}">${escape(caseLabel(item,job))}</a>`:escape(caseLabel(item,job));
  };
  const table=(headers,rows)=>'<table style="border-collapse:collapse;width:100%"><thead><tr>'+headers.map(h=>`<th style="border:1px solid #888;padding:4px">${escape(h)}</th>`).join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>`<td style="border:1px solid #888;padding:4px">${cell}</td>`).join('')+'</tr>').join('')+'</tbody></table><p>&nbsp;</p>';
  const summaryRows=[
    ['Assigned to',escape(job.settings?.rpdName||'')],
    ['Checked',escape(checked)+' (UTC+8)'],
    ['SharePoint assignments',String(job.sharepoint.length)],
    ['Case pages checked',String(items.length)],
    ['Finished / Resolved',String(items.filter(item=>item.attention.finished).length)],
    ['Needs manual checking',String(groups.unclassified.length)]
  ];
  const htmlHeader='<p><strong>📋 Relay Case Review</strong></p>'+table(['Field','Value'],summaryRows);
  const htmlParts=[];
  for(const group of sections){
    const title=group==='unclassified'?'⚠ Needs manual checking':headings[group].replaceAll('**','');
    const sectionTitle=`<p><strong>${escape(title)} (${groups[group].length})</strong></p>`;
    if(!groups[group].length){htmlParts.push(sectionTitle+'<p>None.</p>');continue;}
    const rows=groups[group].map(item=>{
      const from=parents(item);
      const assigned=job.sharepoint.some(row=>row.primary?.key===item.key);
      const relationship=[assigned?'Your SharePoint assignment':'Related case',from.length?'Related to: '+from.map(htmlLink).join('<br>'):''].filter(Boolean).join('<br>');
      const verified=group!=='unclassified';
      return [htmlLink(item),escape(item.latest?.author||'Unavailable')+(verified?'':'<br><em>Latest not verified</em>'),escape(date(item.latest?.date)),escape(reason(item)),relationship];
    });
    let part=[];
    const render=rows=>sectionTitle+table(['Case','Last author','Last reply (UTC+8)','Action / status','Main case / assignment'],rows);
    for(const row of rows){
      if(part.length&&new TextEncoder().encode(htmlHeader+render([...part,row])).length>20000){htmlParts.push(render(part));part=[];}
      part.push(row);
    }
    if(part.length)htmlParts.push(render(part));
  }
  if(warnings.length)htmlParts.push('<p><strong>⚠ Read warnings</strong></p><ul>'+warnings.map(w=>`<li>${escape(w)}</li>`).join('')+'</ul>');
  const htmlReports=[];
  let current=htmlHeader;
  for(const part of htmlParts){
    if(current!==htmlHeader&&new TextEncoder().encode(current+part).length>22000){htmlReports.push(current);current=htmlHeader;}
    current+=part;
  }
  htmlReports.push(current);
  return {groups,message:lines.join('\n'),adaptiveCards:cards,messageHtml:htmlHeader+htmlParts.join(''),htmlReports};
}
async function send(message,settings,title='Relay Case Review',adaptiveCards=[],htmlReports=[]) {
  if(!settings.powerAutomateUrl)throw new Error('Power Automate HTTP URL is not configured.');
  const u=new URL(settings.powerAutomateUrl);
  if(u.protocol!=='https:' || !/(?:^|\.)(?:logic\.azure\.com|environment\.api\.powerplatform\.com)$/.test(u.hostname))throw new Error('Use a Power Automate URL covered by the extension host permissions.');
  deliveryController=new AbortController();
  const timeout=setTimeout(()=>deliveryController?.abort(),25000);
  try {
  const response=await fetch(u.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'Monitor Summary',caseId:'',title,reason:'Case review',parentCase:'',updatedBy:'',updatedDate:new Date().toLocaleString(),comment:message,caseUrl:'',message,htmlReports:htmlReports.length?htmlReports:['<p>Relay test notification.</p>'],messageHtml:htmlReports.length?htmlReports.join('<br>'):'<p>Relay test notification.</p>',adaptiveCards:adaptiveCards.length?adaptiveCards:[{type:'AdaptiveCard',version:'1.2',body:[{type:'TextBlock',text:message,wrap:true}]}]}),signal:deliveryController.signal});
  if(!response.ok)throw new Error(`Power Automate returned HTTP ${response.status}.`);
  }finally{clearTimeout(timeout);deliveryController=null;}
}
async function finish(job) {
  const records=await chrome.storage.local.get(job.queue.map(t=>`cmCase:${t.key}`));
  const items=job.queue.map(task=>{
    const item=records[`cmCase:${task.key}`];
    const current=item?.runId===job.id?{...item,parents:task.parents}:{...task,error:'Case was not read during this run.'};
    return {...current,attention:C.classify(current,job.settings)};
  });
  await C.cancelled();
  const {groups,message,adaptiveCards,messageHtml,htmlReports}=report(job,items);
  const hasAlerts=groups.needsAttention.length+groups.stale.length>0;
  const result={success:true,partial:groups.unclassified.length>0 || job.warnings.length>0,unclassifiedCount:groups.unclassified.length,finishedCount:items.filter(i=>i.attention.finished).length,tabGroups:0,sharePointCases:job.sharepoint.length,rpdWatched:items.filter(i=>i.source==='RPD').length,salesforceWatched:items.filter(i=>i.source==='Salesforce').length,spinOffRpds:job.queue.filter(t=>t.parents.some(p=>!p.startsWith('SP:')) || !job.sharepoint.some(s=>s.primary?.key===t.key)).length,summarySent:false,review:groups,warnings:job.warnings||[],message,adaptiveCards,messageHtml,htmlReports};
  // Run Only preserves the old notification behavior, limited to the two action groups.
  // Run + Send Report sends all four groups, including empty groups.
  if(job.full || (hasAlerts && job.settings.powerAutomateUrl)) {
    if(job.delivery==='failed')result.summaryError=job.deliveryError||'Report delivery failed.';
    else if(job.delivery==='sending')result.summaryError='Previous send was interrupted; delivery is unknown. Not automatically resent.';
    else if(job.delivery==='sent')result.summarySent=true;
    else {
      job.delivery='sending';await saveJob(job,'Sending report…');
      try {await send(message,job.settings,'Relay Case Review',adaptiveCards,htmlReports);job.delivery='sent';result.summarySent=true;}
      catch(e){job.delivery='failed';job.deliveryError=e.message;result.summaryError=e.message;}
      await saveJob(job,'Finishing…');
    }
  }
  await C.cancelled();
  job.status='done';await saveJob(job,'Complete');
  await chrome.storage.local.set({monitorStopRequested:false});
  await chrome.storage.local.set({lastMonitorRun:new Date().toISOString(),lastMonitorResult:result,latestCaseReview:groups,currentWatchList:job.sharepoint,currentRpdWatchList:job.queue.filter(t=>t.source==='RPD'),currentSalesforceWatchList:job.queue.filter(t=>t.source==='Salesforce'),currentSharePointSpinOffs:job.queue.filter(t=>!job.sharepoint.some(s=>s.primary?.key===t.key))});
  await chrome.alarms.clear('cmResume');
}
async function pump() {
  if(busy)return;busy=true;
  // Extension API calls keep the worker active; checkpoints also allow alarm recovery.
  const heartbeat=setInterval(()=>chrome.storage.local.get('monitorStopRequested').catch(()=>{}),20000);
  let job;
  try {
    job=await readJob();if(!job || job.status!=='running')return;
    await C.cancelled();
    if(job.version!=='3.1.0')throw new Error('Previous-version run stopped. Start a new run with version 3.1.0.');
    await cleanupTabs(job);
    if(job.stage==='sharepoint') {
      const data=await sharepoint(job.settings);
      job.sharepoint=data.cases;job.warnings=data.warnings||[];
      job.rootKeys=[...new Set(data.cases.map(x=>x.primary?.key).filter(Boolean))];
      for(const item of data.cases) {
        add(job,item.primary,`SP:${item.title}`,item.title);
        for(const link of item.links||[])add(job,link,item.primary?.key||`SP:${item.title}`);
      }
      if(!data.cases.length)throw new Error('No SharePoint rows match your full name in AM Assignee. No case pages were opened.');
      if(!job.queue.length)throw new Error('Your assigned rows contain no supported case links.');
      job.stage='cases';await saveJob(job,`Reading ${job.queue.length} cases…`);
    }
    while(job.index<job.queue.length) {
      await C.cancelled();const task=job.queue[job.index];
      await saveJob(job,`Reading ${job.index+1}/${job.queue.length}: ${caseLabel(task,job)}`);
      let item;
      try {item=await detail(task,job);}catch(e){item={...task,error:e.message,messages:[],latest:null,warnings:[e.message]};}
      await C.cancelled();
      item.runId=job.id;item.parents=task.parents;
      await chrome.storage.local.set({[`cmCase:${task.key}`]:item});
      for(const warning of item.warnings||[])job.warnings.push(`${caseLabel(item,job)}: ${warning}`);
      if(job.rootKeys.includes(task.key)){
        const direct=(item.links||[]).filter(t=>t.key!==task.key);
        if(direct.length>50)job.warnings.push(`${caseLabel(task,job)}: more than 50 related cases; only the first 50 were queued.`);
        for(const link of direct.slice(0,50))add(job,link,task.key);
      }
      job.index++;await saveJob(job,`Read ${job.index}/${job.queue.length} cases`);
    }
    await C.cancelled();await finish(job);
  } catch(e) {
    if(job) {
      const stopped=(await chrome.storage.local.get('monitorStopRequested')).monitorStopRequested;
      job.status=stopped?'stopped':'failed';await saveJob(job,e.message);
      await chrome.storage.local.set({lastMonitorResult:{success:false,stopped,error:e.message}});
      await chrome.alarms.clear('cmResume');
    }
  } finally {if(job?.version==='3.1.0')await cleanupTabs(job);clearInterval(heartbeat);busy=false;}
}
async function start(full) {
  if(starting)throw new Error('A run is already starting.');
  starting=true;
  try {
  if(busy || (await readJob())?.status==='running')throw new Error('A run is already active.');
  const settings=await loadSettings();
  if(!settings.rpdName.trim())throw new Error('Save your full name and team in Settings first.');
  if(full&&!settings.powerAutomateUrl)throw new Error('Save your Power Automate HTTP URL in Settings before Run + Send Report.');
  const window=await chrome.windows.getLastFocused();
  const job={version:'3.1.0',windowId:window.id,scanTabs:{},id:crypto.randomUUID(),status:'running',stage:'sharepoint',index:0,queue:[],sharepoint:[],warnings:[],full,settings};
  await chrome.storage.local.set({monitorStopRequested:false});
  await saveJob(job,'Reading assigned SharePoint cases…');
  await chrome.alarms.create('cmResume',{periodInMinutes:0.5});
  setTimeout(pump,0);return {success:true,started:true};
  }finally{starting=false;}
}
// Manual runs only. The resume alarm checkpoints an explicitly started run.
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='cmResume')void pump();});
chrome.runtime.onInstalled.addListener(()=>{void chrome.alarms.clear('monitorCases');void pump();});
chrome.runtime.onStartup.addListener(()=>{void pump();});
chrome.runtime.onMessage.addListener((m,s,reply)=>{
  if(!own(s))return;
  const actions={
    GET_DEFAULT_SETTINGS:async()=>{await loadSettings();return {success:true,defaults};},
    RUN_MONITOR_NOW:()=>start(m.sendSummary===true),
    STOP_MONITOR:async()=>{deliveryController?.abort();await chrome.storage.local.set({monitorStopRequested:true});void pump();return {success:true};},
    TEST_TEAMS_NOTIFICATION:async()=>{if(busy||starting||(await readJob())?.status==='running')throw new Error('Wait for the current run to finish before testing.');await send('Relay test notification.',await loadSettings(),'Test');return {success:true};}
  };
  if(!actions[m.action])return;
  actions[m.action]().then(reply).catch(e=>reply({success:false,error:e.message}));return true;
});
