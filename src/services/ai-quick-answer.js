// Narrow FAQ matches only: broader questions still use the provider and authorized tools.
export function quickAnswer(actor, message, policy, units) {
  const q=String(message).trim().toLowerCase().replace(/[?!.]+$/,'').trim();
  const roman=/\b(hamare|humare|kitne|kitny|hain|ha|hai|kya)\b/.test(q);
  if(['Admin','HR'].includes(actor.role) && /^(?:(?:hamare|humare) (?:departments?|departs) (?:kitne|kitny) (?:ha|hain|hai)|how many (?:active )?departments (?:do we have|are there|are in (?:the|our) company)|list (?:our |the )?departments)$/.test(q)) {
    const names=units.filter(u=>u.kind==='department' && u.active).map(u=>u.name);
    return {answer:roman?'Aapki company mein '+names.length+' active departments hain'+(names.length?': '+names.join(', '):'')+'.':'Your company has '+names.length+' active departments'+(names.length?': '+names.join(', '):'')+'.',source:'workspace-records'};
  }
  if(/^(?:what is the (?:late grace rule|office grace period)|office (?:ka )?grace (?:time|period) kya hai)$/.test(q)) {
    return {answer:roman?'Office ka grace time '+policy.graceMinutes+' minutes hai; office '+policy.officeStart+' par shuru hota hai.':'The office grace period is '+policy.graceMinutes+' minutes after the '+policy.officeStart+' start time.',source:'company-policy'};
  }
  return null;
}
