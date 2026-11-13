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
    (sharedCan('manage') ? '<button class="button" data-action="settings">Plan a day</button>' : '') + '</div>';
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

function sharedAvailableStops() {
  return state.deliveries.filter(order => routable(order) && !order.assignedTo && !order.handoffId);
}

function sharedSecondDriverForm() {
  if (!sharedCan('manage') || sharedActiveDay()?.delivery_date !== date()) {
    throw Error('A Business Admin can assign stops on today’s run.');
  }
  const stops = sharedAvailableStops();
  if (!stops.length) throw Error('There are no unassigned delivery stops.');
  const currentDriver = RoutePlanner.startForRoute(state.deliveries.filter(isDeliveryStop), 1)?.claimedBy;
  const second = state.settings.secondDriver;
  const drivers = sharedDriverPeople.filter(person =>
    person.eligible && person.id !== currentDriver && (!second || person.id === second));
  if (!drivers.length) throw Error('No other active driver is available in this workspace.');

  const point = address => state.locations[locationKey(address)];
  const suggested = RoutePlanner.secondDriverStart(stops, state.deliveries, point, point(state.settings.kitchen));
  const options = drivers.map(person => '<option value="' + esc(person.id) + '">' + esc(person.name) + '</option>').join('');
  const choices = stops.map(order => {
    const recommended = order.id === suggested?.id;
    return '<label class="check"><input type="checkbox" name="stops" value="' + esc(order.id) +
      '"' + (recommended ? ' checked' : '') + '><span><strong>' + esc(order.name) +
      (recommended ? ' · Suggested first stop' : '') + '</strong><small>' + esc(order.address) + '</small></span></label>';
  }).join('');
  modal('Assign a second driver', '<form id="sharedSecondDriverForm" class="form-body" data-id="' +
    esc(sharedActiveDay().id) + '" data-first="' + esc(suggested?.id || '') + '">' +
    '<label class="field">Driver<select name="replacement" required><option value="">Choose a driver</option>' +
    options + '</select></label><fieldset class="handoff-stops"><legend>Unassigned stops</legend>' +
    '<p class="help">' + (suggested ? 'The suggested first stop is farthest from the first driver’s recent stops using map distance. Select any additional stops to assign.' :
      'Confirm map locations to get a first-stop suggestion, or select stops now.') + '</p>' +
    choices + '</fieldset><button class="button primary">Assign selected stops</button></form>');
}

async function sharedAssignSecondDriver(form, values) {
  const stops = new FormData(form).getAll('stops');
  if (form.dataset.id !== sharedActiveDay()?.id) throw Error('The run changed. Open the assignment again.');
  await sharedRpc('gldd_assign_remaining_stops', {
    day: form.dataset.id,
    replacement: values.replacement,
    stops,
    first_stop: stops.includes(form.dataset.first) ? form.dataset.first : stops[0] || null
  });
  toast('Stops assigned. Plan remaining stops to refresh both routes.');
}

function sharedKitchenDefaultControl() {
  if (!sharedCan('manage')) return '';
  const day = sharedActiveDay();
  const kitchen = sharedBusiness.settings?.kitchen;
  if (!day || !kitchen || day.kitchen_address === kitchen) return '';
  if (state.deliveries.some(order => isDeliveryStop(order) && ['in_progress', 'delivered'].includes(order.status))) return '';
  return '<p class="help">Workspace default: ' + esc(kitchen) + '</p>' +
    '<button class="button" data-action="useWorkspaceKitchen">Use workspace default</button> ';
}

async function sharedUseWorkspaceKitchen() {
  const day = sharedActiveDay();
  const kitchen = sharedBusiness.settings?.kitchen;
  if (!sharedCan('manage') || !day || !kitchen) throw Error('Choose an open order day with a workspace kitchen.');
  if (!confirm('Use ' + kitchen + ' for ' + day.delivery_date + '? Check the map location and plan the route again after switching.')) return;
  await sharedRun(async () => {
    await sharedRpc('gldd_use_workspace_kitchen', {day: day.id, expected_kitchen: day.kitchen_address});
    delete state.locations[locationKey(kitchen)];
    await sharedLoad();
    toast('Kitchen updated for this day.');
  });
}
