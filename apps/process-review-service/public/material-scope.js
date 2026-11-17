export const isCurrentMaterial=(state,id)=>!state.reviewRound||state.reviewRound.materialIds.includes(id);
export const scopedMaterials=(state,scope='current')=>state.materials.filter(item=>scope==='history'?!isCurrentMaterial(state,item.id):isCurrentMaterial(state,item.id));
export const materialSource=item=>item.currentSource?.relativePath||item.sourcePath;
