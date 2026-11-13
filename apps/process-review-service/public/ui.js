import {splitActorRole,actorRoleValue} from './actor-selection.js';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
export const array = value => Array.isArray(value) ? value : [];
export const short = (value, limit = 70) => String(value || '').length > limit ? String(value).slice(0, limit) + '…' : String(value || '');
export const statusNames = {pending:'待确认',confirmed:'已确认材料版本',planned:'计划中',frozen:'已冻结',needs_followup:'待续议',reviewed:'已完成走查',draft:'草稿',submitted:'已提交',open:'待跟进',in_progress:'跟进中',awaiting_review:'待指定人复核',closed:'已关闭',department:'部门内',cross_department:'跨部门',policy:'涉及制度决定',approve:'同意关闭',return:'退回补充'};
export const tag = (value, label) => `<span class="tag ${['confirmed','reviewed','closed','approve'].includes(value)?'green':['pending','needs_followup','awaiting_review','planned'].includes(value)?'amber':value==='frozen'?'blue':''}">${escape(label || statusNames[value] || value || '待明确')}</span>`;
export const button = (label, action, id = '', options = {}) => `<button class="button ${options.primary?'primary':''} ${options.small?'small':''} ${options.teal?'teal':''} ${options.danger?'danger':''}" data-action="${escape(action)}" data-id="${escape(id)}" ${options.disabled?'disabled':''} ${options.title?`title="${escape(options.title)}"`:''}>${escape(label)}</button>`;
export const empty = (title, message = '') => `<div class="empty"><strong>${escape(title)}</strong>${escape(message)}</div>`;
export const field = (label, value) => `<dt>${escape(label)}</dt><dd>${escape(value || '材料未填写')}</dd>`;
export const dateTime = value => value ? new Date(value).toLocaleString('zh-CN',{hour12:false}) : '—';
export const heading = (title, subtitle, actions = '') => `<div class="page-heading"><div><span class="eyebrow">联合评审工作区</span><h1>${escape(title)}</h1><p class="subtitle">${escape(subtitle)}</p></div><div class="button-row">${actions}</div></div>`;
export const choices = (items, valueKey = 'id', labelKey = 'name') => items.map(item => ({value:item[valueKey],label:item[labelKey]}));
export function options(items, selected = '', blank = '') {
  return `${blank!==null?`<option value="">${escape(blank || '请选择')}</option>`:''}${items.map(item=>`<option value="${escape(item.value)}" ${String(selected)===String(item.value)?'selected':''} ${item.disabled?'disabled':''}>${escape(item.label)}</option>`).join('')}`;
}

let dialogContext;
let submitting = false;
const dialog = document.querySelector('#work-dialog');
const form = document.querySelector('#dialog-form');
const retained = new Map();
export const dirtyDialogs = new Set();
export function dialogOpen() { return dialog.open; }
function actorPositions(roles,actor){
  const items=(roles[actor.department]||[]).map(value=>({value,label:value}));
  if(actor.position&&!items.some(item=>item.value===actor.position))items.push({value:actor.position,label:`${actor.position}（原值保留，待核对）`,disabled:true});
  return options(items,actor.position,'请选择执行岗位');
}
function actorControl(item,value,attributes,labelId){
  const name=escape(item.name),actor=splitActorRole(value,item.roles),prefix=`dialog-field-${name}`;
  return `<div class="actor-picker" role="group" aria-labelledby="${labelId}" ${attributes}><input type="hidden" name="${name}" value="${escape(value)}"><div class="actor-picker-grid"><label for="${prefix}-department">执行部门<select id="${prefix}-department" data-actor-part="department">${options(Object.keys(item.roles).map(value=>({value,label:value})),actor.department,'未指定执行主体')}</select></label><label for="${prefix}-position">执行岗位<select id="${prefix}-position" data-actor-part="position">${actorPositions(item.roles,actor)}</select></label></div><p class="help actor-original">${value?`材料原值：${escape(value)}`:'先选择部门，再从该部门的岗位中选择。'}</p><p class="help actor-mode-note" aria-live="polite"></p></div>`;
}
function syncActorControls(target){
  for(const item of dialogContext.fields.filter(item=>item.type==='actor')){
    const picker=document.getElementById(`dialog-field-${item.name}`),hidden=form.elements[item.name];
    const department=picker.querySelector('[data-actor-part="department"]'),position=picker.querySelector('[data-actor-part="position"]');
    if(target===department){
      const previous=splitActorRole(hidden.value,item.roles);
      hidden.value=actorRoleValue(department.value,department.value?previous.position||previous.unresolved:'');
      position.innerHTML=actorPositions(item.roles,splitActorRole(hidden.value,item.roles));
    }else if(target===position)hidden.value=actorRoleValue(department.value,position.value);
    const mode=form.elements.actor_assignment_mode?.value;
    const fixed=!mode||mode==='fixed_department';
    department.disabled=!fixed;position.disabled=!fixed||!department.value;
    picker.querySelector('.actor-mode-note').textContent=fixed?'切换部门后，请核对并选择对应岗位。':'当前按规则确定执行主体，办理角色原值保留，请填写部门分配规则。';
  }
}
function controlHtml(item, value, attributes, labelId) {
  const name = escape(item.name);
  if (item.type === 'actor') return actorControl(item,value,attributes,labelId);
  if (item.type === 'checks') return `<div class="check-list" role="group" aria-labelledby="${labelId}" ${attributes}>${item.choices.map(choice=>`<label class="check-item"><input type="checkbox" name="${name}" value="${escape(choice.value)}" ${array(value).includes(choice.value)?'checked':''}><span>${escape(choice.label)}</span></label>`).join('') || '<span class="subtle-text">暂无可选项</span>'}</div>`;
  const control = `name="${name}" ${attributes} ${item.required?'required':''} ${item.max?`maxlength="${item.max}"`:''}`;
  if (item.type === 'textarea') return `<textarea ${control} rows="${item.rows||3}" ${item.readOnly?'readonly':''} placeholder="${escape(item.placeholder||'')}">${escape(value)}</textarea>`;
  if (item.type === 'select') return `<select ${control}>${options(item.choices, value, item.blank || '待明确 / 暂不指定')}</select>`;
  if (item.type === 'file') return `<input type="file" ${control} accept=".json,application/json" multiple ${item.directory?'webkitdirectory':''}><span class="subtle-text">${value?.length?`已保留上次选择的 ${value.length} 个文件；重新选择将替换本项。`:''}</span>`;
  return `<input type="${item.type || 'text'}" ${control} value="${escape(value)}" placeholder="${escape(item.placeholder||'')}">`;
}
function fieldHtml(item, value) {
  const name = escape(item.name);
  const id = `dialog-field-${name}`, labelId = `${id}-label`;
  const helpId = `field-help-${name}`, statusId = `field-status-${name}`;
  const descriptions = [item.help ? helpId : '', item.status ? statusId : ''].filter(Boolean).join(' ');
  const attributes = `id="${id}" ${descriptions ? `aria-describedby="${descriptions}"` : ''}`;
  const label = `${escape(item.label)}${item.required ? '<span aria-hidden="true"> *</span>' : ''}`;
  const caption = ['checks','actor'].includes(item.type) ? `<span class="form-label" id="${labelId}">${label}</span>` : `<label for="${id}">${label}</label>`;
  return `<div class="form-field ${item.full?'full':''}">${caption}${controlHtml(item,value,attributes,labelId)}${item.help?`<span class="help" id="${helpId}">${escape(item.help)}</span>`:''}${item.status?`<p class="field-status" id="${statusId}" aria-live="polite"></p>`:''}</div>`;
}
export function dialogValues() {
  const values = {};
  if (!dialogContext) return values;
  const data = new FormData(form);
  for (const item of dialogContext.fields) {
    if (item.type==='file') {const selected=form.elements[item.name]?.files;values[item.name] = selected?.length?selected:dialogContext.restored[item.name];}
    else if(item.type==='select')values[item.name]=form.elements[item.name].value;
    else values[item.name] = item.type==='checks' ? data.getAll(item.name) : String(data.get(item.name) ?? '');
  }
  return values;
}
export function openDialog({key,title,fields,values={},description='',submit='保存',onSubmit,onSaved,userId,baseRevision,getRevision,trackInitialValues=false,transient=false}) {
  const retentionKey = `${userId}:${key}`;
  const restored = {...values,...(transient?undefined:retained.get(retentionKey))};
  const initialValues = trackInitialValues ? restored.__initialValues ?? values : undefined;
  dialogContext = {key:retentionKey,fields,onSubmit,onSaved,restored,baseRevision:restored.__baseRevision??baseRevision,getRevision,initialValues,transient};
  document.querySelector('#dialog-title').textContent = title;
  document.querySelector('#dialog-submit').textContent = submit;
  const closeLabel=transient?'取消':'保留输入并关闭';
  dialog.querySelector('header [data-close-dialog]').setAttribute('aria-label',closeLabel);
  dialog.querySelector('footer [data-close-dialog]').textContent=closeLabel;
  document.querySelector('#dialog-retention').hidden=transient;
  document.querySelector('#dialog-body').innerHTML = `${description?`<div class="form-callout">${escape(description)}</div>`:''}<div class="form-grid">${fields.map(item=>fieldHtml(item,restored[item.name]??(item.type==='checks'?[]:''))).join('')}</div>`;
  document.querySelector('#dialog-error').hidden = true;
  syncActorControls();
  updateFieldStatuses();
  dialog.showModal();
  document.querySelector('#dialog-body').scrollTop=0;
}
export function closeDialog(discard = false) {
  if(submitting&&!discard)return;
  if (dialogContext) {
    if (discard) { retained.delete(dialogContext.key); dirtyDialogs.delete(dialogContext.key); }
    else if (dirtyDialogs.has(dialogContext.key)) retainDialog(dialogValues());
  }
  dialog.close(); dialogContext = null;
  window.dispatchEvent(new Event('draftstatechange'));
}
function retainDialog(values) {
  retained.set(dialogContext.key,{...values,__baseRevision:dialogContext.baseRevision,__initialValues:dialogContext.initialValues});
}
function updateFieldStatuses(){
  const fields=dialogContext.fields.filter(item=>item.status);
  if(!fields.length)return;
  const values=dialogValues();
  for(const item of fields){
    const status=document.getElementById(`field-status-${item.name}`),text=item.status(values);
    if(status.textContent!==text)status.textContent=text;
  }
}
form.addEventListener('input',event=>{
  if (!dialogContext || dialogContext.transient) return;
  syncActorControls(event.target);
  dirtyDialogs.add(dialogContext.key); retainDialog(dialogValues());
  updateFieldStatuses();
  window.dispatchEvent(new Event('draftstatechange'));
});
form.addEventListener('submit',async event=>{
  event.preventDefault(); if (!dialogContext) return;
  if(submitting)return;
  const submit = document.querySelector('#dialog-submit');
  const error = document.querySelector('#dialog-error');
  const submittedValues=dialogValues();
  const {onSaved}=dialogContext;
  const lockedControls=[...form.elements].filter(control=>!control.disabled);
  lockedControls.forEach(control=>{control.disabled=true;});
  submitting=true;submit.disabled = true; error.hidden = true;
  try { await dialogContext.onSubmit(submittedValues,dialogContext.baseRevision,dialogContext.initialValues); closeDialog(true); }
  catch (failure) {
    error.textContent = failure.message; error.hidden = false;
    if(failure.status===409){dialogContext.baseRevision=dialogContext.getRevision?.()??dialogContext.baseRevision;if(!dialogContext.transient)retainDialog(submittedValues);}
    return;
  }
  finally { submitting=false;lockedControls.forEach(control=>{control.disabled=false;});submit.disabled = false; }
  onSaved?.();
});
form.addEventListener('click',event=>{if(event.target.closest('[data-close-dialog]')) closeDialog();});
dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
