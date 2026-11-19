'use strict';
/* Owner-only administration: Telegram Auto Save and portable batch cover images.
 * Requires app.js and its authenticated api() helper. */
function coverPreview(input,imageId){
  const el=document.getElementById(imageId);
  const file=input?.files?.[0];
  if(!file){el.removeAttribute('src');el.classList.add('hidden');return}
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){input.value='';throw new Error('Use JPEG, PNG or WebP')}
  if(file.size>1.5*1024*1024){input.value='';throw new Error('Image must be under 1.5 MB')}
  if(file.size<16){input.value='';throw new Error('Image file is empty')}
  const reader=new FileReader();
  reader.onload=()=>{el.src=reader.result;el.classList.remove('hidden')};
  reader.readAsDataURL(file);
}
async function uploadBatchCover(id,file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>1.5*1024*1024||file.size<16)throw new Error('Use an image under 1.5 MB');
  const res=await fetch('/api/admin/batches/'+encodeURIComponent(id)+'/cover',{
    method:'PUT',
    headers:{'content-type':file.type,'x-telegram-init-data':initData},
    body:file
  });
  let data;
  try{data=await res.json()}catch{throw new Error('Image upload failed (HTTP '+res.status+')')}
  if(!res.ok)throw new Error(data.error||'Upload rejected');
  return data;
}
async function loadAutoSaveStatus(){
  const s=await api('/admin/auto-save');
  const el=document.getElementById('v2AutoSaveStatus');
  if(s.is_active){
    el.classList.add('active');
    el.innerHTML='<b>● AUTO SAVE ON</b><div>'+escapeHtml(s.batch_title)+' › '+escapeHtml(s.subject_title)+' › '+escapeHtml(s.chapter_title)+'</div><small>✅ '+Number(s.saved_videos||0)+' videos · 📄 '+Number(s.saved_pdfs||0)+' PDFs saved this session</small>';
  }else{
    el.classList.remove('active');
    el.innerHTML='<b>■ AUTO SAVE OFF</b><div>Select a batch, subject and chapter, then tap Start.</div>';
  }
  document.getElementById('v2StopAutoSave').disabled=!s.is_active;
  const cfg=await api('/config');
  const link=document.getElementById('v2AutoSaveBotLink');
  if(cfg.botUsername){link.href='https://t.me/'+cfg.botUsername;link.classList.remove('hidden')}
  else{link.classList.add('hidden')}
  return s;
}
document.getElementById('adminAutoSaveForm').onsubmit=async function(event){
  event.preventDefault();
  const chapterId=this.elements.chapterId.value;
  if(!chapterId)return toast('Select batch, subject and chapter');
  const button=this.querySelector('[type=submit]');button.disabled=true;
  try{
    await api('/admin/auto-save/start',{method:'POST',body:JSON.stringify({chapterId})});
    await loadAutoSaveStatus();
    toast('Auto Save ON — now send media to your TEST Telegram bot');
  }catch(err){toast(err.message)}finally{button.disabled=false}
};
document.getElementById('v2StopAutoSave').onclick=async()=>{
  try{await api('/admin/auto-save/stop',{method:'POST',body:'{}'});await loadAutoSaveStatus();toast('Auto Save stopped')}catch(err){toast(err.message)}
};
document.getElementById('v2RefreshAutoSave').onclick=()=>loadAutoSaveStatus().catch(e=>toast(e.message));
document.querySelector('#adminBatchForm [name=coverImage]').addEventListener('change',e=>{
  try{coverPreview(e.target,'v2BatchCoverPreview')}catch(err){toast(err.message)}
});
document.querySelector('#adminCoverForm [name=coverImage]').addEventListener('change',e=>{
  try{coverPreview(e.target,'v2EditCoverPreview')}catch(err){toast(err.message)}
});
document.getElementById('adminCoverForm').onsubmit=async function(event){
  event.preventDefault();const batchId=this.elements.batchId.value,file=this.elements.coverImage.files?.[0];
  if(!batchId||!file)return toast('Choose batch and image');
  const button=this.querySelector('[type=submit]');button.disabled=true;
  try{
    await uploadBatchCover(batchId,file);toast('Batch cover saved ✓');
    this.elements.coverImage.value='';
    await loadAdmin();
    // Published batch artwork is fetched from public route; drafts remain private.
  }catch(err){toast(err.message)}finally{button.disabled=false}
};
document.getElementById('v2RemoveCover').onclick=async()=>{
  const form=document.getElementById('adminCoverForm');
  const batchId=form.elements.batchId.value;
  if(!batchId)return toast('Select a batch first');
  if(!confirm('Remove this batch cover image?'))return;
  try{
    await api('/admin/batches/'+encodeURIComponent(batchId)+'/cover',{method:'DELETE'});
    form.elements.coverImage.value='';
    document.getElementById('v2EditCoverPreview').classList.add('hidden');
    await loadAdmin();
    toast('Batch cover removed');
  }catch(err){toast(err.message)}
};
document.querySelector('#adminCoverForm [name=batchId]').onchange=async(e)=>{
  const el=document.getElementById('v2EditCoverPreview'),id=e.target.value;
  el.classList.add('hidden');el.removeAttribute('src');
  if(!id)return;
  try{
    const response=await fetch('/api/admin/batches/'+encodeURIComponent(id)+'/cover',{headers:{'x-telegram-init-data':initData}});
    if(response.status===404)return;
    if(!response.ok)throw new Error('Could not load existing cover');
    const blob=await response.blob();
    // Object URLs are revoked on next edit or page reload.
    if(el.dataset.objectUrl)URL.revokeObjectURL(el.dataset.objectUrl);
    const url=URL.createObjectURL(blob);el.dataset.objectUrl=url;
    el.src=url;el.classList.remove('hidden');
  }catch(err){toast(err.message)}
};
