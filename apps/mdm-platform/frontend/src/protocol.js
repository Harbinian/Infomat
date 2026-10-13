import '../../shared/browserProtocol.js';
export const protocol = globalThis.MdmProtocol;
export const pages = Object.freeze(Object.fromEntries(protocol.pages.map(page=>[page.href,page.title])));
export const navigation = Object.freeze(protocol.pages.filter(page=>page.navigation!==null).sort((a,b)=>a.navigation-b.navigation));
// Parent groups in business-flow order; each group carries its ordered child pages.
export const navigationGroups = Object.freeze(protocol.navigationGroups.map(group=>Object.freeze({
  ...group,
  items: Object.freeze(navigation.filter(page=>page.group===group.code))
})));
