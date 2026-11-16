'use strict';

const censusAddressCache = new Map();
const checkAddressWithPhoton = checkAddress;
let activeAddressCheck = null;

function missingAddressMessage(kitchen, address = '') {
  return kitchen
    ? '<p>No house-number match. Check the street address and ZIP code.</p><button type="button" class="button" data-action="alternateAddress" data-kitchen="true">Try US Census address lookup</button>'
    : splitContactAddress(address).postalCode
      ? '<p>No address match. Double-check the spelling and ZIP code with the customer, or ask them to send a Maps link.</p><a class="button" target="_blank" rel="noopener" href="' + esc(navigation(address)) + '">Open in Maps ↗</a>'
      : '<p>No address match. Ask the customer for their ZIP code and confirm the street address.</p>';
}

function addressMatchKey(address) {
  return addressUnit(address).query.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function alternateAddress(kitchen = false) {
  clearTimeout(addressSearchTimer);
  const input = addressForm(kitchen)?.querySelector(kitchen ? '[name="kitchen"]' : '[name="address"]');
  const address = (input?.value || (kitchen ? state.settings.kitchen : '')).trim();
  const output = $('#addressCheck');
  if (!address || !output) return;
  const generation = ++addressSearchGeneration;
  const current = () => generation === addressSearchGeneration &&
    output.isConnected !== false && (!input || (input.isConnected !== false && input.value.trim() === address));
  addressMatches = [];
  output.textContent = 'Checking address with the US Census…';

  try {
    const business = sharedBusiness?.id;
    if (!authUser || !business) throw Error('Sign in to check this address.');
    const query = addressUnit(address).query;
    const key = business + '|' + locationKey(query);
    const cached = censusAddressCache.get(key);
    let matches = cached && Date.now() - cached.time < 300000 ? cached.matches : null;
    if (!matches) {
      const client = await initAuth();
      if (!current()) return;
      const {data, error} = await client.functions.invoke('geocode-address', {body: {address: query, business}});
      if (error) throw error;
      matches = data?.matches || [];
      const withoutZip = query.replace(/,?\s+\d{5}(?:-\d{4})?$/, '');
      if (!kitchen && !matches.length && withoutZip !== query && current()) {
        const retry = await client.functions.invoke('geocode-address', {body: {address: withoutZip, business}});
        if (!retry.error) matches = retry.data?.matches || [];
      }
      if (censusAddressCache.size >= 50) censusAddressCache.delete(censusAddressCache.keys().next().value);
      censusAddressCache.set(key, {matches, time: Date.now()});
    }
    if (!current()) return;
    addressMatches = matches.map(match => ({...match, address, kitchen, unit: addressUnit(address).unit}));
    const exact = !kitchen && addressMatches.length === 1 &&
      addressMatchKey(addressMatches[0].formattedAddress || addressMatches[0].label) === addressMatchKey(address);
    if (exact) {
      await chooseAddress(0);
      return true;
    }
    output.innerHTML = addressMatches.length
      ? '<p>Review the full address and choose the match to check driving miles.</p>' +
        '<div class="address-suggestions" role="group" aria-label="Matching addresses">' +
        addressMatches.map((match, index) => '<button type="button" class="address-match" data-action="chooseAddress" data-id="' +
          index + '">' + esc(match.label) + '</button>').join('') +
        '</div><p class="help">US Census location estimate.</p>'
      : missingAddressMessage(false, address);
    return current() && matches.length > 0;
  } catch {
    if (current()) output.textContent = 'US Census lookup is unavailable. Try checking again in a moment.';
  }
}

checkAddress = async function(kitchen = false, automatic = false) {
  clearTimeout(addressSearchTimer);
  const form = addressForm(kitchen);
  const input = form?.querySelector(kitchen ? '[name="kitchen"]' : '[name="address"]');
  const address = (input?.value || (kitchen ? state.settings.kitchen : '')).trim();
  const useCensus = !kitchen && !automatic && Boolean(authUser && sharedBusiness);
  if (activeAddressCheck && activeAddressCheck.input === input && activeAddressCheck.address === address &&
      activeAddressCheck.kitchen === kitchen && activeAddressCheck.useCensus === useCensus &&
      activeAddressCheck.generation === addressSearchGeneration) return activeAddressCheck.promise;

  const check = {input, address, kitchen, useCensus, generation: addressSearchGeneration + 1};
  const button = form?.querySelector('[data-action="checkAddress"]');
  const output = $('#addressCheck');
  if (button) button.setAttribute('aria-busy', 'true');
  activeAddressCheck = check;
  check.promise = (async () => {
    try {
      if (!kitchen && !automatic && address && output && state.locations?.[locationKey(address)]) {
        addressSearchGeneration++;
        addressMatches = [];
        output.textContent = 'Calculating driving miles…';
        const current = () => check.generation === addressSearchGeneration && input?.isConnected && input.value.trim() === address;
        try {
          await calculateMileage(address);
          if (current()) output.textContent = mileageLabel(address);
        } catch (error) {
          if (current()) output.textContent = 'Address matched. ' + error.message;
        }
        return;
      }
      if (useCensus) {
        const matched = await alternateAddress();
        if (matched || check.generation !== addressSearchGeneration ||
            !input?.isConnected || input.value.trim() !== address) return;
        check.generation++;
      }
      await checkAddressWithPhoton(kitchen, automatic);
      if (check.generation !== addressSearchGeneration || addressMatches.length ||
          (input && (input.isConnected === false || input.value.trim() !== address))) return;
      const target = output || $('#addressCheck');
      if (address && target && !target.textContent.startsWith('Address suggestions are unavailable')) {
        target.innerHTML = missingAddressMessage(kitchen, address);
      }
    } finally {
      if (activeAddressCheck === check || activeAddressCheck?.input !== input) button?.removeAttribute('aria-busy');
      if (activeAddressCheck === check) activeAddressCheck = null;
    }
  })();
  return check.promise;
};

const sharedResetBeforeAddressTools = sharedReset;
sharedReset = function() {
  addressMatches = [];
  addressSearchCache.clear();
  censusAddressCache.clear();
  addressSearchGeneration++;
  clearTimeout(addressSearchTimer);
  sharedResetBeforeAddressTools();
};

const workspaceOrigins = new Map();
async function ensureWorkspaceOrigin() {
  const address = state.settings.kitchen;
  if (!address) throw Error('Set the workspace address in Business settings.');
  const key = locationKey(address);
  if (state.locations[key]) return state.locations[key];
  if (!workspaceOrigins.has(key)) {
    const lookup = async () => {
      const matchesOrigin = match => workspaceAddressKey(match.formattedAddress || match.label) === workspaceAddressKey(address);
      try {
        const data = await fetchPublic('https://photon.komoot.io/api/?limit=5&lang=en&lat=39.83&lon=-86.25&q=' + encodeURIComponent(address));
        const exact = addressCandidates(data, address, true).find(matchesOrigin);
        if (exact) return exact;
      } catch {
        // Census can still resolve the origin when the map lookup is unavailable.
      }
      const client = await initAuth();
      const {data, error} = await client.functions.invoke('geocode-address', {
        body: {address, business: sharedBusiness.id}
      });
      const exact = !error && data?.matches?.find(matchesOrigin);
      if (exact) return exact;
      throw Error('Could not locate the workspace address. Review it in Business settings.');
    };
    workspaceOrigins.set(key, lookup().finally(() => workspaceOrigins.delete(key)));
  }
  const point = await workspaceOrigins.get(key);
  if (locationKey(state.settings.kitchen) !== key) throw Error('Workspace changed. Check miles again.');
  state.locations[key] = {...point, address};
  return state.locations[key];
}

function workspaceAddressKey(address) {
  const suffixes = {indiana:'in', street:'st', avenue:'ave', drive:'dr', road:'rd', court:'ct', boulevard:'blvd', lane:'ln', place:'pl'};
  return addressMatchKey(address).split(' ').map(word => suffixes[word] || word).join(' ');
}
