'use strict';
function sharedMobileNav(){const orders=sharedCan('orders'),buttons=orders?[['today','Run'],['customers','Customers'],['add','＋ New Order','action'],['summary','Summary'],['more','More','action']]:[['today','Run'],['activity','My activity'],['more','More','action']];$('#mobileNav').hidden=false;$('#mobileNav').innerHTML=buttons.map(([key,label,type])=>`<button ${type?'data-action':'data-tab'}="${key}" ${!type&&tab===key?'aria-current="page"':''}>${label}</button>`).join('');}
function sharedMoreMenu() {
  const orders = sharedCan('orders');
  const manage = sharedCan('manage');
  const sections = [
    ['Operations', [
      ...(manage ? [['action', 'settings', 'Plan a day']] : []),
      ...(sharedCan('drive') || manage ? [['action', 'handoffMenu', 'Driver handoff']] : []),
      ...(orders ? [['tab', 'history', 'History']] : []),
      ['tab', 'activity', orders ? 'Activity' : 'My activity']
    ]],
    ['Business', [
      ...(orders ? [['tab', 'items', 'Items']] : []),
      ...(manage ? [['action', 'workspaceSettings', 'Business settings']] : []),
      ...(sharedOwner ? [['tab', 'team', 'Staff access']] : [])
    ]],
    ['Account', [['action', 'account', 'My account'], ['action', 'signout', 'Sign out']]]
  ];
  const content = sections.filter(([, links]) => links.length).map(([title, links]) =>
    '<section class="more-section"><h3>' + title + '</h3>' +
    links.map(([type, key, label]) =>
      '<button type="button" class="button" data-' + type + '="' + key + '">' + label + '</button>'
    ).join('') + '</section>'
  ).join('');
  modal('Your workspace', '<div class="form-body more-menu">' + content + '</div>');
}
function routeLegMarkup(d){const leg=d.routeLeg;if(!leg||!Number.isFinite(leg.miles)||!Number.isFinite(leg.seconds))return '';const labels={kitchen:'kitchen',current_stop:'current stop',last_completed:'last completed stop',previous_stop:'previous stop'};return `<p class="route-leg">Planned leg: ${esc(leg.miles.toFixed(1))} miles · ${esc(String(Math.max(1,Math.round(leg.seconds/60))))} min from ${esc(labels[leg.kind]||'previous stop')}<small>Driving estimate · no live traffic</small></p>`;}
