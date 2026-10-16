(() => {
  const $=id=>document.getElementById(id);
  let starting=false,running=false,refreshId=0;
  function message(text,error=false){$('runStatus').textContent=text;$('runStatus').classList.toggle('error',error);}
  function theme(value){const light=value==='light';document.documentElement.dataset.theme=light?'light':'dark';$('themeButton').textContent=light?'🌙':'☀️';$('themeButton').setAttribute('aria-label',light?'Switch to dark theme':'Switch to light theme');}
  function close(id){if($(id).open)$(id).close();}
  function open(id){if(!$(id).open)$(id).showModal();}
  async function refresh(){
    const id=++refreshId;const s=await chrome.storage.local.get(['cmJob','monitorProgress','monitorStopRequested','lastMonitorResult','lastMonitorRun','cmTheme']);if(id!==refreshId)return;
    const j=s.cmJob,r=s.lastMonitorResult,queue=j?.queue||[];running=j?.status==='running';theme(s.cmTheme);
    $('runButton').disabled=running||starting;$('stopButton').classList.toggle('hidden',!running);$('stopButton').disabled=!!s.monitorStopRequested;
    $('statusText').textContent=running?(s.monitorStopRequested?'Stopping…':'Running'):starting?'Starting…':j?.status==='failed'?'Run failed':j?.status==='stopped'?'Stopped':r?.summaryError?'Delivery failed':r?.partial?'Complete — review warnings':'Ready';
    $('statusDot').dataset.state=running||starting?'running':j?.status==='failed'||r?.summaryError?'failed':'ready';
    $('lastRun').textContent=s.lastMonitorRun?'Last completed run: '+new Date(s.lastMonitorRun).toLocaleString():'No completed run yet';
    if(running){close('runDialogOverlay');message([s.monitorProgress,`${j.index||0}/${queue.length} case pages read`].filter(Boolean).join('\n'));}
    else if(!starting){close('stopDialogOverlay');message(r?.error||[s.monitorProgress,r?.summarySent?'Report accepted by Power Automate.':'',r?.summaryError].filter(Boolean).join('\n'),!!(r?.error||r?.summaryError));}
    $('sharePointCount').textContent=j?.sharepoint?.length||0;$('rpdCount').textContent=queue.filter(t=>t.source==='RPD').length;$('salesforceCount').textContent=queue.filter(t=>t.source==='Salesforce').length;$('spinOffCount').textContent=queue.filter(t=>(t.parents||[]).some(p=>!p.startsWith('SP:'))).length;
    document.querySelector('.stats').title='Counts include queued case pages.';$('report').textContent=r?.message||'';
  }
  async function start(sendSummary){
    if(starting||running)return;starting=true;close('runDialogOverlay');$('runButton').disabled=true;$('statusText').textContent='Starting…';message('Starting case review…');
    try{const r=await chrome.runtime.sendMessage({action:'RUN_MONITOR_NOW',sendSummary});if(!r?.success)throw Error(r?.error||'Could not start the monitor.');}
    finally{starting=false;$('runButton').disabled=running;}
    await refresh();
  }
  async function records(){const {cmJob:job}=await chrome.storage.local.get('cmJob');const keys=(job?.queue||[]).map(t=>'cmCase:'+t.key);const stored=keys.length?await chrome.storage.local.get(keys):{};return {job,cases:Object.values(stored).filter(c=>c&&c.runId===job?.id)};}
  function bind(id,action){$(id).onclick=async()=>{try{await action();}catch(e){message('Error: '+e.message,true);if(!running&&!starting)$('statusText').textContent='Ready';}};}
  bind('settingsButton',()=>chrome.runtime.openOptionsPage());
  bind('themeButton',async()=>{const value=document.documentElement.dataset.theme==='light'?'dark':'light';theme(value);await chrome.storage.local.set({cmTheme:value});});
  bind('runButton',()=>{if(!running&&!starting)open('runDialogOverlay');});bind('cancelRunButton',()=>close('runDialogOverlay'));
  bind('runWithReportButton',()=>start(true));bind('runOnlyButton',()=>start(false));
  bind('stopButton',()=>{if(running)open('stopDialogOverlay');});bind('keepRunningButton',()=>close('stopDialogOverlay'));
  bind('confirmStopButton',async()=>{close('stopDialogOverlay');$('stopButton').disabled=true;try{const r=await chrome.runtime.sendMessage({action:'STOP_MONITOR'});if(!r?.success)throw Error(r?.error||'Stop was not confirmed.');await refresh();}catch(e){$('stopButton').disabled=false;throw e;}});
  bind('serviceWorkerButton',()=>chrome.tabs.create({url:'chrome://extensions/?id='+chrome.runtime.id}));
  bind('copyReportButton',async()=>{const text=$('report').textContent;if(!text.trim())throw Error('There is no report to copy yet.');await navigator.clipboard.writeText(text);message('Report copied.');});
  bind('exportHistoryButton',async()=>{const {job,cases}=await records();const data={version:'3.1.0',runId:job?.id,sharepoint:job?.sharepoint||[],cases};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='my-case-history.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);message('Case history export requested.');});
  bind('copyDiagnosticsButton',async()=>{const {job,cases}=await records();const data={version:'3.1.0',status:job?.status,roots:job?.rootKeys,cases:cases.map(c=>({key:c.key,error:c.error,latest:c.latest&&{author:c.latest.author,date:c.latest.date},diagnostics:c.diagnostics,warnings:c.warnings}))};await navigator.clipboard.writeText(JSON.stringify(data,null,2));message('Diagnostics copied.');});
  for(const id of ['runDialogOverlay','stopDialogOverlay'])$(id).addEventListener('click',event=>{if(event.target!==$(id))return;const r=$(id).getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)close(id);});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.cmTheme)theme(changes.cmTheme.newValue);if(Object.keys(changes).some(k=>k!=='cmTheme'&&!k.startsWith('cmCase:')))refresh().catch(e=>message(e.message,true));});
  refresh().catch(e=>message(e.message,true));
})();
