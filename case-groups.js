/* One group per SharePoint main case; related main cases do not merge families. */
function planCaseGroups(job,items) {
  const byKey=new Map(items.map(x=>[x.key,x]));
  const roots=[...new Set(job.sharepoint.map(x=>x.primary?.key).filter(Boolean))];
  const rootSet=new Set(roots),rank={needsAttention:0,stale:1,waiting:2};
  const plans=[];
  for(const root of roots) {
    const seen=new Set(),keys=[],pending=[root];
    while(pending.length) {
      const key=pending.shift();if(seen.has(key))continue;seen.add(key);
      if(byKey.has(key))keys.push(key);
      if(key!==root && rootSet.has(key))continue;
      for(const child of job.queue)if((child.parents||[]).includes(key))pending.push(child.key);
    }
    const qualifying=keys.map(k=>byKey.get(k)).filter(i=>Object.hasOwn(rank,i.attention.group));
    if(!qualifying.length)continue;
    qualifying.sort((a,b)=>rank[a.attention.group]-rank[b.attention.group]);
    const state=qualifying[0].attention.group,main=byKey.get(root);
    plans.push({root,keys,state,title:`${{needsAttention:'🚨',stale:'⏰',waiting:'⏳'}[state]} ${main.source==='Salesforce'?'SF':'RPD'} ${main.caseNumber||main.id}`,color:{needsAttention:'red',stale:'yellow',waiting:'blue'}[state]});
  }
  return plans;
}
async function reconcileCaseGroups(job,items) {
  const plans=planCaseGroups(job,items),byKey=new Map(items.map(x=>[x.key,x]));
  const previous=(await chrome.storage.local.get({cmCaseGroups:[]})).cmCaseGroups;
  const retained=new Set(),output=[],warnings=[];
  const matches=async(ref,key)=>{
    if(!ref?.tabId)return null;
    try{const t=await chrome.tabs.get(ref.tabId);return CM.target(t.url)?.key===key && t.windowId===job.windowId && !t.pinned?t:null;}catch{return null;}
  };
  for(const plan of plans) {
    await CM.cancelled();const old=previous.find(g=>g.root===plan.root && g.windowId===job.windowId),refs=[];
    try {
      for(const key of plan.keys) {
        const oldRef=old?.tabs?.find(t=>t.key===key);
        let tab=await matches(oldRef,key);
        if(tab && retained.has(tab.id))tab=null;
        if(!tab){tab=await matches({tabId:job.scanTabs?.[key]},key);if(tab&&retained.has(tab.id))tab=null;}
        if(!tab)tab=await chrome.tabs.create({url:byKey.get(key).url,windowId:job.windowId,active:false});
        retained.add(tab.id);refs.push({key,tabId:tab.id});
      }
      // Move in the exact main-first order; create a group only after ordering.
      const ids=refs.map(r=>r.tabId);
      await chrome.tabs.ungroup(ids);
      await chrome.tabs.move(ids,{windowId:job.windowId,index:-1});
      const groupId=await chrome.tabs.group({tabIds:ids});
      await chrome.tabGroups.update(groupId,{title:plan.title,color:plan.color,collapsed:false});
      output.push({...plan,groupId,windowId:job.windowId,tabs:refs});
    } catch(e) {
      warnings.push(`Could not group ${plan.root}: ${e.message}`);
      output.push({...plan,windowId:job.windowId,tabs:refs});
    }
    // Persist each family so closing/reopening the popup does not create duplicate tabs.
    await chrome.storage.local.set({cmCaseGroups:[...previous.filter(g=>g.windowId!==job.windowId),...output]});
  }
  // Never close tabs belonging to another window or tabs whose user navigated away.
  const candidates=new Map();
  for(const g of previous.filter(g=>g.windowId===job.windowId))for(const r of g.tabs||[])candidates.set(r.tabId,r.key);
  for(const [key,id]of Object.entries(job.scanTabs||{}))candidates.set(id,key);
  for(const [id,key]of candidates) {
    if(retained.has(id))continue;
    // Failed reads stay available for inspection but are not labelled as actionable.
    if(byKey.get(key)?.attention.group==='unclassified')continue;
    const tab=await matches({tabId:id},key);
    if(tab&&!tab.active&&!tab.audible)await chrome.tabs.remove(id).catch(()=>{});
  }
  await chrome.storage.local.set({cmCaseGroups:[...previous.filter(g=>g.windowId!==job.windowId),...output]});
  return {count:output.length,warnings};
}
