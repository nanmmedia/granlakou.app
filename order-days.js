'use strict';

function sharedDayPicker() {
  if (!sharedCan('orders')) return '';
  const days = sharedDays.filter(day => !day.archived && day.delivery_date >= date())
    .sort((a, b) => a.delivery_date.localeCompare(b.delivery_date));
  const selected = sharedActiveDay()?.id;
  const options = days.map(day => '<option value="' + esc(day.id) + '"' +
    (day.id === selected ? ' selected' : '') + '>' + esc(day.delivery_date) +
    (day.delivery_date === date() ? ' · Today' : ' · Upcoming') + '</option>').join('');
  return '<div class="scheduled-day">' +
    (options ? '<label class="field">Order day<select id="scheduledDay">' + options + '</select></label>' : '') +
    '<button class="button" data-action="settings">Start or schedule a day</button></div>';
}

function setSharedOrderType(form, type) {
  form.insertAdjacentHTML('afterbegin', '<label class="field">Order type<select name="orderType">' +
    '<option value="delivery">Delivery</option><option value="pickup">Pickup</option></select></label>');
  form.elements.orderType.value = type;
  form.querySelector('[type="submit"]').textContent = form.dataset.id ? 'Save changes' : 'Add Order';
  const heading = form.closest('#modal')?.querySelector('h2');
  if (heading && form.dataset.id) heading.textContent = 'Edit order';
  applyOrderType(form);
}

function applyOrderType(form) {
  const pickup = form.elements.orderType.value === 'pickup';
  for (const group of form.querySelectorAll('[data-delivery-only]')) {
    group.hidden = pickup;
    for (const input of group.querySelectorAll('input,select,button')) {
      // Restore required fields if the order switches back to delivery.
      if (input.required) input.dataset.deliveryRequired = 'true';
      if (input.dataset.deliveryRequired) input.required = !pickup;
      input.disabled = pickup;
    }
  }
  updateOrderTotal();
}

document.addEventListener('change', event => {
  const input = event.target;
  if (input.name === 'orderType' && input.form?.id === 'deliveryForm') applyOrderType(input.form);
});

function sharedPickupList() {
  if (!sharedCan('orders') || !sharedActiveDay()) return '';
  const orders = state.deliveries.filter(order => order.orderType === 'pickup');
  const cards = orders.map(order => {
    const id = esc(order.id);
    const status = { ready: 'Awaiting pickup', delivered: 'Picked up', cancelled: 'Cancelled' }[order.status] || order.status;
    let actions = '';
    if (order.status === 'ready') {
      actions = (sharedActiveDay().delivery_date === date() ? '<button class="button lime" data-action="pickupComplete" data-id="' + id + '">Mark picked up</button>' : '') +
        '<button class="button" data-action="edit" data-id="' + id + '">Edit</button>' +
        '<button class="button" data-action="cancelOrder" data-id="' + id + '">Cancel order</button>';
    }
    if (order.status === 'delivered') actions = '<button class="button" data-action="receipt" data-id="' + id + '">Receipt ↗</button>';
    return '<div class="activity"><strong>' + esc(order.name) + '</strong> · ' + esc(status) +
      '<p>' + esc(orderSummary(order)) + ' · ' + money(total(order)) + '</p>' +
      '<div class="stop-actions">' + actions + '</div></div>';
  }).join('');
  return '<section class="panel pickup-list"><div class="panel-head"><h2>Pickups</h2><span>' + orders.length +
    ' orders</span></div>' + (cards || '<div class="empty">No pickups scheduled.</div>') + '</section>';
}

function sharedPickupForm(order) {
  if (!sharedCan('orders') || order?.orderType !== 'pickup' || order.status !== 'ready') {
    throw Error('Choose an order awaiting pickup.');
  }
  modal('Complete pickup', '<form id="sharedPickupForm" class="form-body" data-id="' + esc(order.id) +
    '"><p><strong>' + esc(order.name) + '</strong> · ' + money(total(order)) + '</p>' +
    '<label class="check"><input name="paid" type="checkbox" required>Payment received</label>' +
    '<label class="field">Payment method<select name="method" required><option value="">Choose a method</option>' +
    '<option>Cash</option><option>Zelle</option><option>Cash App</option></select></label>' +
    '<button class="button primary">Picked up · open receipt</button></form>');
}
