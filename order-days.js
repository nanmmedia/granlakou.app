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

function sharedOrderPageOpen() {
  return $('#orderPage')?.hidden === false;
}

function closeSharedOrderPage() {
  const page = $('#orderPage');
  if (!page || page.hidden) return;
  page.hidden = true;
  page.replaceChildren();
  document.body.classList.remove('order-page-open');
}

function showSharedOrderStep(form, step, focus = true) {
  form.dataset.step = step;
  for (const panel of form.querySelectorAll('[data-order-step]')) panel.hidden = Number(panel.dataset.orderStep) !== step;
  for (const marker of form.querySelectorAll('[data-step-marker]')) {
    if (Number(marker.dataset.stepMarker) === step) marker.setAttribute('aria-current', 'step');
    else marker.removeAttribute('aria-current');
  }
  form.querySelector('[data-order-back]').hidden = step === 1;
  form.querySelector('[data-order-next]').hidden = step === 3;
  form.querySelector('[type="submit"]').hidden = step !== 3;
  if (focus) {
    form.querySelector('[data-order-step="' + step + '"] h2').focus();
    window.scrollTo({top: 0, behavior: 'instant'});
  }
}

function validateSharedOrderStep(form, step) {
  const panel = form.querySelector('[data-order-step="' + step + '"]');
  if (step === 1 && form.elements.phone.value.trim()) {
    form.elements.phone.setCustomValidity('');
    try { normalizeContactPhone(form.elements.phone.value); }
    catch (error) { form.elements.phone.setCustomValidity(error.message); }
  }
  const invalid = Array.from(panel.querySelectorAll('input,select,textarea')).find(input => !input.checkValidity());
  if (!invalid) return true;
  showSharedOrderStep(form, step);
  invalid.reportValidity();
  return false;
}

function validateSharedOrderForm(form) {
  const step = Number(form.dataset.step);
  if (step < 3) {
    if (validateSharedOrderStep(form, step)) showSharedOrderStep(form, step + 1);
    return false;
  }
  return [1, 2, 3].every(number => validateSharedOrderStep(form, number));
}

function sharedDeliveryForm(id = '', customer = '', orderDate = (sharedSelectedDay && sharedActiveDay()?.delivery_date) || date()) {
  const order = state.deliveries.find(item => item.id === id);
  if (id && (!order || !editable(order))) {
    toast('Only unstarted orders can be edited.');
    return;
  }
  const contact = order || state.customers.find(item => item.id === customer) || {};
  const page = $('#orderPage');
  const names = ['Customer', 'Items', 'Review'];
  const savedCustomers = !order && state.customers.length
    ? '<label class="field">Saved customer<select id="savedCustomer"><option value="">New customer</option>' +
      state.customers.map(item => '<option value="' + esc(item.id) + '">' + esc(item.name) + '</option>').join('') +
      '</select></label>' : '';
  const unit = field('Apt, building, or suite (optional)', 'unit', contact.unit || '', 'text', 'maxlength="50" autocomplete="address-line2"');
  const steps = names.map((name, index) => '<li data-step-marker="' + (index + 1) + '">' + (index + 1) + '. ' + name + '</li>').join('');
  const type = '<label class="field">Order type<select name="orderType"><option value="delivery">Delivery</option><option value="pickup">Pickup</option></select></label>';
  const dateField = id ? '' : field('Order date', 'orderDate', orderDate, 'date', 'required min="' + date() + '"');
  const fee = field('Delivery fee ($)', 'fee', order?.fee ?? state.settings.nearFee ?? 5, 'number', 'min="0" max="999" required step="0.01"');

  page.innerHTML = '<div class="order-page-heading"><h1>' + (id ? 'Edit order' : 'New Order') +
    '</h1><button type="button" class="button" data-action="close">Cancel</button></div>' +
    '<ol class="order-steps" aria-label="Order steps">' + steps + '</ol>' +
    '<form id="deliveryForm" class="order-page-form" novalidate data-id="' + esc(id) +
    '" data-day="' + esc(sharedActiveDay()?.id || '') + '" data-customer="' + esc(contact.customerId || contact.id || '') + '">' +
    '<section data-order-step="1"><h2 tabindex="-1">Customer & delivery</h2>' + dateField + type + savedCustomers +
    '<div class="order-fields-grid">' +
    field('Customer name', 'name', contact.name, 'text', 'required maxlength="100" autocomplete="name"') +
    field('Phone number', 'phone', formatContactPhone(contact.phone), 'tel', 'required maxlength="25" autocomplete="tel"') +
    '</div><div data-delivery-only>' + contactAddressFields('address', contact.address, contact.addressParts, 'Delivery address', {unit}) +
    '<button type="button" class="button address-check-button" data-action="checkAddress">Check driving distance</button>' +
    '<div id="addressCheck" class="help" aria-live="polite">' + esc(mileageLabel(contact.address)) +
    '</div></div></section>' +
    '<section data-order-step="2" hidden><h2 tabindex="-1">Choose items</h2>' + orderFields(order || {}) + '</section>' +
    '<section data-order-step="3" hidden><h2 tabindex="-1">Review your order</h2><p data-order-review></p>' +
    '<div data-delivery-only>' + fee +
    '<p class="help">Use the driving distance to decide the delivery fee.</p>' +
    '<label class="order-option"><input type="checkbox" name="priority"' + (order?.priority ? ' checked' : '') + '> Priority delivery</label>' +
    '<div data-order-deadline>' + field('Deliver by (optional)', 'deadline', order?.deadline, 'time') + '</div></div>' +
    '<details class="order-notes"' + (order?.notes ? ' open' : '') + '><summary>Add a note</summary>' +
    '<label class="field">Order note<textarea name="notes" rows="3" maxlength="500">' + esc(order?.notes || '') + '</textarea></label></details>' +
    '<div class="order-total" id="orderTotal" aria-live="polite"></div></section>' +
    '<p class="order-form-error" role="alert" hidden></p><div class="order-page-actions"><button type="button" class="button" data-order-back>Back</button>' +
    '<button type="button" class="button primary" data-order-next>Continue →</button>' +
    '<button class="button primary" type="submit">' + (id ? 'Save changes' : 'Save order') + '</button></div></form>';

  if ($('#dialog').open) $('#dialog').close();
  $('#modal').replaceChildren();
  page.hidden = false;
  document.body.classList.add('order-page-open');
  const form = $('#deliveryForm');
  if (savedCustomers) $('#savedCustomer').value = customer;
  form.elements.orderType.value = order?.orderType || 'delivery';

  const updateOptions = () => {
    const pickup = form.elements.orderType.value === 'pickup';
    applyOrderType(form);
    const deadline = form.querySelector('[data-order-deadline]');
    deadline.hidden = !form.elements.priority.checked;
    form.elements.deadline.disabled = pickup || deadline.hidden;
  };
  const openStep = step => {
    if (step === 3) {
      const kind = form.elements.orderType.value === 'pickup' ? 'Pickup' : 'Delivery';
      form.querySelector('[data-order-review]').textContent = [form.elements.name.value, kind,
        form.elements.orderDate?.value || order?.day,
        kind === 'Delivery' ? mileageLabel(form.elements.address.value) : ''].filter(Boolean).join(' · ');
    }
    showSharedOrderStep(form, step);
  };
  form.querySelector('[data-order-next]').addEventListener('click', () => {
    if (sharedBusy) return;
    const step = Number(form.dataset.step);
    if (validateSharedOrderStep(form, step)) openStep(step + 1);
  });
  form.querySelector('[data-order-back]').addEventListener('click', () => openStep(Number(form.dataset.step) - 1));
  form.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.tagName === 'INPUT' && Number(form.dataset.step) < 3) {
      event.preventDefault();
      form.querySelector('[data-order-next]').click();
    }
  });
  form.addEventListener('change', event => {
    if (['priority', 'orderType'].includes(event.target.name)) updateOptions();
  });
  updateOptions();
  updateAddressCheckCue(form);
  showSharedOrderStep(form, 1);
}

function fillSharedOrderContact(form, id) {
  const contact = state.customers.find(item => item.id === id);
  form.dataset.customer = contact?.customerId || contact?.id || '';
  form.elements.name.value = contact?.name || '';
  form.elements.phone.value = formatContactPhone(contact?.phone);
  form.elements.phone.setCustomValidity('');
  form.elements.unit.value = contact?.unit || '';
  const group = form.querySelector('[data-address-group="address"]');
  const parts = contact?.addressParts || splitContactAddress(contact?.address);
  for (const input of group.querySelectorAll('[data-address-part]')) {
    const part = input.dataset.addressPart;
    input.value = parts[part] || (part === 'city' && !contact ? 'Indianapolis' : '');
    input.setCustomValidity('');
  }
  const address = syncContactAddress(group);
  addressSearchGeneration++;
  clearTimeout(addressSearchTimer);
  addressMatches = [];
  $('#addressCheck').textContent = mileageLabel(address);
  updateAddressCheckCue(form);
}
