// The original measured demo remains its own unchanged entry point.
let project={};
let configError=null;
try {
  const response=await fetch('/project-config.json',{cache:'no-store'});
  if(response.status!==404){
    if(!response.ok)throw Error(`加载失败，HTTP ${response.status}`);
    project=await response.json();
    if(!project||typeof project!=='object'||Array.isArray(project))throw Error('配置必须是 JSON 对象，不能是数组或 null');
  }
}catch(error){configError=error;}
if(configError){
  const diagnostic=document.createElement('div');diagnostic.id='projectConfigError';diagnostic.setAttribute('role','alert');diagnostic.className='selection';
  const title=document.createElement('strong');title.textContent='project-config.json 配置错误';
  const detail=document.createElement('p');detail.textContent=`${configError.message}。请修正项目根目录中的 project-config.json，然后刷新页面。`;
  diagnostic.append(title,detail);document.querySelector('#stageHost').replaceChildren(diagnostic);document.querySelector('.transport').hidden=true;document.querySelector('#inspectorToggle').hidden=true;document.title='project-config.json 配置错误 · Prompt Spider';
}else if(new URLSearchParams(location.search).has('session') || Object.keys(project).length) {
  // chrome=none: 嵌入模式——隐藏顶栏/标题行/控制抽屉, 画布占满视口
  if(new URLSearchParams(location.search).get('chrome')==='none')document.body.classList.add('chromeless');
  const sid=new URLSearchParams(location.search).get('session');
  if(sid){
    try{localStorage.setItem('ps-last-session',sid);}catch(error){}
    document.querySelector('.wordmark').insertAdjacentHTML('afterend','<a class="mode-switch" href="/" title="切换到预设参考演示">▶ 参考演示</a>');
  }
  const {startLive}=await import('./live.js');
  await startLive(project);
} else {
  // 参考演示模式: 若本机看过会话回放, 提供一键切回(token 由 live.js 的 sessionStorage 回退接管)
  let last=null;try{last=localStorage.getItem('ps-last-session');}catch(error){}
  if(last)document.querySelector('.wordmark').insertAdjacentHTML('afterend',`<a class="mode-switch" href="/?session=${encodeURIComponent(last)}" title="切回最近一次会话回放">⟲ 回放上次会话</a>`);
  await import('./main.js');
}
