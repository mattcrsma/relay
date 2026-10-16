(() => {
  const $=id=>document.getElementById(id);
  let loaded=false;
  function message(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error);}
  function theme(value){const light=value==='light';document.documentElement.dataset.theme=light?'light':'dark';$('themeButton').textContent=light?'🌙':'☀️';$('themeButton').setAttribute('aria-label',light?'Switch to dark theme':'Switch to light theme');}
  function empty(){ $('emptyTeam').classList.toggle('hidden',!!$('teamMembers').children.length); }
  function field(parent,labelText,key,value){const label=document.createElement('label');label.textContent=labelText;const input=document.createElement('input');input.dataset.field=key;input.value=value||'';input.autocomplete='off';label.append(input);parent.append(label);}
  function addMember(person={}){
    const row=document.createElement('div');row.className='teamMember';const main=document.createElement('div');main.className='memberRow';
    field(main,'Name','name',person.name);field(main,'Author Alias','ownerAlias',person.ownerAlias);
    const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='Remove';remove.onclick=()=>{row.remove();empty();};main.append(remove);row.append(main);
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Additional matching details';details.append(summary);
    const extra=document.createElement('div');extra.className='row';field(extra,'Email (optional)','email',person.email);field(extra,'Employee ID (optional)','employeeId',person.employeeId);details.append(extra);row.append(details);$('teamMembers').append(row);empty();return row;
  }
  function readTeam(){return [...$('teamMembers').children].map(row=>Object.fromEntries([...row.querySelectorAll('input')].map(input=>[input.dataset.field,input.value.trim()]))).filter(person=>Object.values(person).some(Boolean)).map(person=>{if(!person.name)throw Error('Enter a full name for each team member.');return person;});}
  function readUrl(required=false){
    const value=$('flowUrl').value.trim();if(!value){if(required)throw Error('Paste your Power Automate HTTP URL first.');return '';}
    let url;try{url=new URL(value);}catch{throw Error('Enter the complete HTTPS trigger URL.');}
    if(url.protocol!=='https:'||!/(^|\.)(logic\.azure\.com|environment\.api\.powerplatform\.com)$/i.test(url.hostname)||url.username||url.password||value.includes('\\')||/\s/.test(value))throw Error('Enter a Power Automate HTTPS URL without spaces or backslashes.');return value;
  }
  async function load(){
    const r=await chrome.runtime.sendMessage({action:'GET_DEFAULT_SETTINGS'});if(!r?.success||!r.defaults)throw Error(r?.error||'Could not load defaults from background.js. Reload the extension and reopen Settings.');
    const s=await chrome.storage.local.get({...r.defaults,cmTheme:'dark'});theme(s.cmTheme);$('rpdName').value=s.rpdName||r.defaults.rpdName||'';$('salesforceAlias').value=s.salesforceAlias||'';$('flowUrl').value=s.powerAutomateUrl||'';
    $('teamMembers').replaceChildren();(Array.isArray(s.myTeam)?s.myTeam:r.defaults.myTeam||[]).forEach(addMember);empty();loaded=true;message('status','Settings loaded.');
  }
  function bind(id,action,statusId='status'){$(id).onclick=async()=>{try{await action();}catch(e){message(statusId,e.message,true);}};}
  bind('saveButton',async()=>{if(!loaded)throw Error('Wait for settings to load.');const rpdName=$('rpdName').value.trim();if(!rpdName)throw Error('Enter your full name.');await chrome.storage.local.set({rpdName,salesforceAlias:$('salesforceAlias').value.trim(),myTeam:readTeam(),powerAutomateUrl:readUrl()});message('status','Settings saved.');});
  bind('testButton',async()=>{const powerAutomateUrl=readUrl(true);$('testButton').disabled=true;message('testStatus','Sending test notification…');try{await chrome.storage.local.set({powerAutomateUrl});const r=await chrome.runtime.sendMessage({action:'TEST_TEAMS_NOTIFICATION'});if(!r?.success)throw Error(r?.error||'The background worker did not confirm the test.');message('testStatus','Power Automate accepted the test. Check Teams or your flow run history.');}finally{$('testButton').disabled=false;}},'testStatus');
  bind('addTeamMemberButton',()=>{if(!loaded)throw Error('Wait for settings to load.');const row=addMember();row.scrollIntoView({block:'nearest'});row.querySelector('input').focus();});
  bind('toggleUrl',()=>{const show=$('flowUrl').type==='password';$('flowUrl').type=show?'text':'password';$('toggleUrl').textContent=show?'Hide':'Show';});
  bind('themeButton',async()=>{const value=document.documentElement.dataset.theme==='light'?'dark':'light';theme(value);await chrome.storage.local.set({cmTheme:value});});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.cmTheme)theme(changes.cmTheme.newValue);});
  load().catch(e=>message('status',e.message,true));
})();
