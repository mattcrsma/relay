(() => {
  if(globalThis.CMReaders?.salesforce?.version==='3.1.0')return;
  const C=CM;
  const accepted=new Set(['EmailMessageEvent','TextPost','ContentPost','LinkPost','QuestionPost','CaseCommentPost']);
  function parseArticle(a) {
    if(!accepted.has(a.dataset.type))return null; // Exclude status/assignment audit events.
    const h=a.querySelector('.cuf-feedItemHeader');
    const actor=h?.querySelector('.preamble_left');
    const copy=actor?.cloneNode(true);copy?.querySelectorAll('.cuf-additionalActorLink').forEach(e=>e.remove());
    const author=C.text(copy),authorType=h?.querySelector('img[src*="eventcustomer"]')?'client':'employee';
    const authorId=actor?.querySelector('[data-id]')?.dataset.id||'';
    const iso=[...a.querySelectorAll('.slds-assistive-text,.assistiveText')].map(C.text).map(x=>x.match(/^Comment on .*? at (\d{4}-\d\d-\d\dT[^\s]+Z)$/)?.[1]).find(Boolean);
    const time=a.querySelector('time[datetime]');
    const date=iso||time?.getAttribute('datetime')||'';
    const preview=a.querySelector('iframe[title="Email Preview"]');
    const emailHtml=preview?.getAttribute('srcdoc');
    let body=null;
    if(emailHtml){body=new DOMParser().parseFromString(emailHtml,'text/html').body;body.querySelectorAll('script,style,[style*="display:none"],[style*="display: none"]').forEach(e=>e.remove());}
    const expanded=a.querySelector('.cuf-body,.feedBodyInner,.feedBody,.forceChatterFeedBodyText');
    const summary=a.querySelector('.preamble_custom-summary');
    if(!body)body=expanded||summary;
    const isEmail=a.dataset.type==='EmailMessageEvent';
    return {id:a.dataset.id,kind:a.dataset.type,author,authorId,authorType,date,displayDate:C.text(h?.querySelector('.compactTimeStamp')),text:C.text(body),bodyAvailable:isEmail?!!emailHtml:!!expanded,links:isEmail?[]:C.explicitLinks(body)};
  }
  function snapshot(root=document){return [...root.querySelectorAll('article.cuf-feedItem[data-id][data-type]')].map(parseArticle).filter(Boolean);}
  function relations(root=document){return C.links(root.querySelector('.cCaseRpdRelatedList'));}
  function scope(feed){return feed.closest('.oneContent,.oneRecordHomeFlexipage,.recordHomeFlexipage2')||document;}
  async function read(expected) {
    if(C.target(location.href)?.key!==expected?.key)throw new Error('Salesforce URL does not match the queued case.');
    // Match the actual record feed, never a hidden console tab or a dispatch list.
    const feedTab=[...document.querySelectorAll('[role="tab"]')].find(e=>C.visible(e)&&C.text(e)==='Feed');
    if(feedTab&&feedTab.getAttribute('aria-selected')!=='true'){feedTab.click();await C.sleep(500);}
    let feed=await C.waitFor(()=>[...document.querySelectorAll('.cuf-feed[data-feed-type="Record"]')].find(e=>[...e.classList].some(c=>c.startsWith('qe-subject-id-')&&c.slice(14,29)===expected.id.slice(0,15))),25000);
    let root=scope(feed);
    const warnings=[],history=new Map(),seen=new WeakSet();
    const allUpdates=[...root.querySelectorAll('[role="tab"]')].find(e=>C.visible(e)&&C.text(e)==='All Updates');
    if(allUpdates&&allUpdates.getAttribute('aria-selected')!=='true') {
      allUpdates.click();await C.sleep(1500);
      feed=await C.waitFor(()=>[...document.querySelectorAll('.cuf-feed[data-feed-type="Record"]')].find(e=>[...e.classList].some(c=>c.startsWith('qe-subject-id-')&&c.slice(14,29)===expected.id.slice(0,15))),25000);
      root=scope(feed);
    }
    let previous='',stable=0,ended=false;
    const scroll=C.scroller(feed),original=scroll.scrollTop;scroll.scrollTop=0;
    try {
      for(let round=0;round<160;round++) {
        await C.cancelled();
        for(const a of feed.querySelectorAll('article.cuf-feedItem[data-type]')) {
          if(!accepted.has(a.dataset.type))continue;
          const open=[...a.querySelectorAll('a,button')].find(e=>C.visible(e)&&C.text(e)==='Click to expand post');
          if(open){open.click();await C.sleep(200);}
        }
        for(const b of feed.querySelectorAll('a,button')) {
          if(C.visible(b)&&!seen.has(b)&&/^(?:Show more|View more|Load more|View all comments|Show all comments|More comments)$/i.test(C.text(b))){seen.add(b);b.click();await C.sleep(250);}
        }
        await C.sleep(400);
        for(const m of snapshot(feed))history.set(m.id,m);
        const signature=JSON.stringify([...history.values()].map(m=>[m.id,m.date,m.text.length,m.bodyAvailable]))+scroll.scrollHeight+':'+scroll.scrollTop;
        const bottom=scroll.scrollTop+scroll.clientHeight>=scroll.scrollHeight-5;
        stable=bottom&&signature===previous?stable+1:0;
        if(stable>=5){ended=true;break;}
        previous=signature;
        const trigger=feed.parentElement?.querySelector('.loadMoreTrigger');
        if(bottom&&trigger)trigger.scrollIntoView({block:'end'});
        else scroll.scrollTop+=Math.max(200,scroll.clientHeight*.8);
        scroll.dispatchEvent(new Event('scroll',{bubbles:true}));await C.sleep(400);
      }
    }finally{scroll.scrollTop=original;}
    const messages=[...history.values()],latest=C.latest(messages);
    if(!ended)warnings.push('Feed scan limit reached; some older history may be missing.');
    const incomplete=messages.filter(m=>!m.bodyAvailable).length;
    if(incomplete)warnings.push(`${incomplete} message(s) have only a preview available; full text was not verified.`);
    const comments=feed.querySelectorAll('.forceChatterComment,.forceChatterFeedComment');
    // Unknown nested comment markup must not silently produce a handled result.
    const unknownReplies=comments.length>0;
    if(unknownReplies)warnings.push('Nested feed replies found; this layout needs verification before choosing the latest message.');
    const card=root.querySelector('.cCaseRpdRelatedList');
    let related=relations(root);
    const cardContainer=card?.closest('flexipage-component2');
    const count=Number(C.text(cardContainer?.querySelector('[title^="Case RPDs ("]')).match(/\((\d+)\)/)?.[1]||0);
    if(count>related.length){
      const button=cardContainer?.querySelector('a[title="View All Case RPDs"]');
      if(button){button.click();await C.sleep(900);const dialog=[...document.querySelectorAll('[role="dialog"]')].find(e=>C.visible(e)&&/Case RPDs/.test(C.text(e)));
        if(dialog){related=[...new Map([...related,...C.links(dialog)].filter(t=>t.source==='RPD').map(t=>[t.key,t])).values()];const close=dialog.querySelector('button[title="Close"],button[aria-label="Close"]');close?.click();}
      }
    }
    if(count>related.length)warnings.push(`Case RPDs card shows ${count} records but only ${related.length} links loaded. Open View All Case RPDs to inspect the remainder.`);
    const f=name=>C.text(root.querySelector(`[data-target-selection-name="sfdc:RecordField.Case.${name}"] .test-id__field-value`));
    return {...expected,title:f('Subject')||document.title,caseNumber:f('CaseNumber')||C.caseNumber(expected),status:f('Status'),messages,latest,links:[...new Map([...related,...messages.flatMap(m=>m.links)].filter(t=>t.key!==expected.key).map(t=>[t.key,t])).values()],error:unknownReplies?'Nested Salesforce replies could not be verified.':!latest?'Could not verify the latest Salesforce author and UTC timestamp.':'',warnings,historyCoverage:'Loaded case feed after scrolling and expanding messages; other activity views are not assumed complete.',capturedAt:new Date().toISOString(),diagnostics:{feedCase:expected.id,messageCount:messages.length,previewOnly:incomplete,feedTypes:[...new Set([...feed.querySelectorAll('article[data-type]')].map(e=>e.dataset.type))]}};
  }
  globalThis.CMReaders||={};globalThis.CMReaders.salesforce={version:'3.1.0',read,snapshot,relations};
})();
