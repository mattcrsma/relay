(() => {
  if(globalThis.CMReaders?.rpd?.version==='3.1.0')return;
  const C=CM;
  function snapshot(root=document) {
    return [...root.querySelectorAll('.reply')].filter(e=>e.querySelector('[id^="msgContent_"]')).map(e=>{
      const header=e.querySelector('.replyHeader'),a=header?.querySelector('.comment-author'),person=a?.querySelector('[type="employee"],[type="client"]');
      const id=a?.dataset.messagekey||e.dataset.messagekey;
      const body=e.querySelector('[id^="msgContent_"]');
      const raw=header?.querySelector('.created-date .date[defaultvalue]')?.getAttribute('defaultvalue');
      const date=raw?raw.trim().replace(' ','T'):'';
      return {id,author:C.text(person?.querySelector('[data-individual-id]')||person),authorType:person?.getAttribute('type')||'unknown',authorId:person?.getAttribute('data-employee-id')||person?.getAttribute('data')||'',authorEmail:person?.getAttribute('data-email')||'',date,text:C.text(body),links:C.explicitLinks(body),bodyAvailable:!!body};
    });
  }
  function relations(root=document,currentKey='') {
    const panel=root.querySelector('.propertiesBox.linkedRPDs');
    return C.links(panel).filter(t=>t.key!==currentKey);
  }
  async function read(expected) {
    const current=C.target(location.href);if(!current||current.key!==expected?.key)throw new Error('RPD URL does not match the queued case.');
    await C.waitFor(()=>document.querySelector('.reply [id^="msgContent_"]'));
    const warnings=[];
    const show=document.querySelector('#showProperties');if(C.visible(show)){show.click();await C.sleep(500);}
    let panel;
    try{panel=await C.waitFor(()=>document.querySelector('.propertiesBox.linkedRPDs'),7000);}catch{warnings.push('Linked/Duplicate properties panel unavailable.');}
    if(panel){const content=panel.querySelector(':scope > .content');if(content?.classList.contains('hidden')){panel.querySelector('.header')?.click();await C.sleep(500);}}
    await C.expand(document.querySelector('#summaryContent')||document,/^(?:show|load|view) (?:all|more|older) (?:comments|replies|messages)$/i);
    await C.cancelled();
    const messages=snapshot(),latest=C.latest(messages),related=new Map();
    for(const t of [...relations(document,current.key),...messages.flatMap(m=>m.links)])if(t.key!==current.key)related.set(t.key,t);
    const counts=panel?['linkRPDCount','duplicateRPDCount'].map(id=>Number(C.text(panel.querySelector('#'+id)))||0):[];
    if(counts.reduce((a,b)=>a+b,0)>relations(document,current.key).length)warnings.push('Not all counted Linked/Duplicate RPDs were loaded.');
    if(!messages.length||!latest)warnings.push('RPD message headers could not be fully verified.');
    return {...current,title:C.text(document.querySelector('#summaryLinkControl')?.getAttribute('data-title'))||document.title,status:document.querySelector('#status')?.getAttribute('status')||'',messages,latest,links:[...related.values()],warnings,error:!latest?'Could not verify the latest RPD author and timestamp.':'',historyCoverage:'All message bodies present in the loaded summary, including collapsed bodies.',capturedAt:new Date().toISOString(),diagnostics:{messageCount:messages.length,linkedCounts:counts,unverifiedHeaders:messages.filter(m=>!m.author||C.stamp(m.date)===null).map(m=>({id:m.id,author:m.author,date:m.date}))}};
  }
  globalThis.CMReaders||={};globalThis.CMReaders.rpd={version:'3.1.0',read,snapshot,relations};
})();
