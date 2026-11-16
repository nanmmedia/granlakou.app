'use strict';

const censusAddressCache = new Map();
const checkAddressWithPhoton = checkAddress;
let activeAddressCheck = null;

function missingAddressMessage(kitchen, address = '') {
  return kitchen
    ? '<p>No house-number match. Check the street address and ZIP code.</p><button type="button" class="button" data-action="alternateAddress" data-kitchen="true">Try US Census address lookup</button>'
    : splitContactAddress(address).postalCode
      ? '<p>No address match. Double-check the spelling and ZIP code with the customer, or ask them to send a Maps link.</p>'
      : '<p>No address match. Ask the customer for their ZIP code and confirm the street address.</p>';
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
      if (censusAddressCache.size >= 50) censusAddressCache.delete(censusAddressCache.keys().next().value);
      censusAddressCache.set(key, {matches, time: Date.now()});
    }
    if (!current()) return;
    addressMatches = matches.map(match => ({...match, address, kitchen, unit: addressUnit(address).unit}));
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
