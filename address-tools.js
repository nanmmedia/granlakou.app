'use strict';
const alternateAddressCache=new Map();
function addressFallbackControls(address,kitchen){return `<p>The map could not match this house number. This does not mean the address is wrong. Your entered address is unchanged.</p><button type="button" class="button" data-action="alternateAddress" data-kitchen="${kitchen}">Try US Census address lookup</button><details class="manual-map"><summary>Use a map pin instead</summary><p class="help">Open your Maps app and check the destination. Paste its latitude and longitude only after confirming the pin is at the correct address.</p><a class="button" target="_blank" rel="noopener" href="${esc(navigation(address))}">Open address in Maps ↗</a><div class="two">${field('Latitude','manualLat','','number','step="any" inputmode="decimal"')}${field('Longitude','manualLon','','number','step="any" inputmode="decimal"')}</div><label class="check"><input type="checkbox" name="manualConfirmed">I checked that the pin matches this delivery address.</label><button type="button" class="button" data-action="useCoordinates" data-kitchen="${kitchen}">Use this map pin</button></details>`;}
async function alternateAddress(kitchen=false,address=null,expectedGeneration=null){const form=addressForm(kitchen),input=form?.querySelector(kitchen?'[name="kitchen"]':'[name="address"]');address=(address||input?.value||(kitchen?state.settings.kitchen:'')).trim();if(!address)return;const generation=expectedGeneration??++addressSearchGeneration,output=$('#addressCheck');if(!output)return;const current=()=>generation===addressSearchGeneration&&(!input||input.value.trim()===address);output.textContent='Trying another US street-address source…';try{if(!authUser||typeof sharedBusiness==='undefined'||!sharedBusiness)throw Error('Sign in to use the alternate lookup.');const key=locationKey(addressUnit(address).query);let matches=alternateAddressCache.get(key);if(!matches){const client=await initAuth(),{data,error}=await client.functions.invoke('geocode-address',{body:{address:addressUnit(address).query,business:sharedBusiness.id}});if(error)throw Error('Alternate lookup unavailable.');matches=data?.matches||[];if(alternateAddressCache.size>=50)alternateAddressCache.delete(alternateAddressCache.keys().next().value);alternateAddressCache.set(key,matches);}if(!current())return;addressMatches=matches.map(m=>({...m,address,kitchen,unit:addressUnit(address).unit}));output.innerHTML=addressMatches.length?`<p>Review the full address and choose the match:</p><div class="address-suggestions" role="group" aria-label="Matching addresses">${addressMatches.map((m,i)=>`<button type="button" class="address-match" data-action="chooseAddress" data-id="${i}">${esc(m.label)}</button>`).join('')}</div><p class="help">US Census address-range estimate. Check the destination in Maps; this is not rooftop or USPS verification.</p>`:addressFallbackControls(address,kitchen);}catch{if(current())output.innerHTML='<p>Address lookup is unavailable right now.</p>'+addressFallbackControls(address,kitchen);}}
const checkAddressWithPhoton = checkAddress;
let activeAddressCheck = null;
checkAddress = async function(kitchen = false, automatic = false) {
  clearTimeout(addressSearchTimer);
  const form = addressForm(kitchen);
  const input = form?.querySelector(kitchen ? '[name="kitchen"]' : '[name="address"]');
  const address = (input?.value || (kitchen ? state.settings.kitchen : '')).trim();
  const output = $('#addressCheck');
  if (activeAddressCheck && activeAddressCheck.input === input && activeAddressCheck.address === address &&
      activeAddressCheck.kitchen === kitchen && activeAddressCheck.generation === addressSearchGeneration) {
    return activeAddressCheck.promise;
  }
  const check = {input, address, kitchen, generation: addressSearchGeneration + 1};
  const button = form?.querySelector('[data-action="checkAddress"]');
  if (button) button.setAttribute('aria-busy', 'true');
  activeAddressCheck = check;
  check.promise = (async () => {
    try {
      await checkAddressWithPhoton(kitchen, automatic);
      if (check.generation !== addressSearchGeneration || addressMatches.length ||
          (input && (!input.isConnected || input.value.trim() !== address))) return;
      const target = output || $('#addressCheck');
      if (address && target) {
        const unavailable = target.textContent.startsWith('Address suggestions are unavailable');
        target.innerHTML = (unavailable ? '<p>Map lookup is unavailable right now.</p>' : '') + addressFallbackControls(address, kitchen);
      }
    } finally {
      if (activeAddressCheck === check) {
        activeAddressCheck = null;
        button?.removeAttribute('aria-busy');
      }
    }
  })();
  return check.promise;
};
async function useAddressCoordinates(kitchen=false){const form=addressForm(kitchen)||$('#dialog'),address=(form.querySelector(kitchen?'[name="kitchen"]':'[name="address"]')?.value||(kitchen?state.settings.kitchen:'')).trim(),latText=form.querySelector('[name="manualLat"]')?.value,lonText=form.querySelector('[name="manualLon"]')?.value,lat=Number(latText),lon=Number(lonText);if(!latText?.trim()||!lonText?.trim()||!Number.isFinite(lat)||!Number.isFinite(lon)||lat<=38.9||lat>=40.7||lon<= -87.2||lon>= -85.1)throw Error('Enter valid map coordinates in the Indianapolis service area.');if(!form.querySelector('[name="manualConfirmed"]')?.checked)throw Error('Check the map pin and confirm it matches the address.');addressMatches=[{address,formattedAddress:address,label:address,lat,lon,kitchen,provider:'Staff-confirmed map pin',accuracy:'manual'}];if(kitchen&&typeof sharedReady!=='undefined'&&sharedReady)await sharedChooseKitchen(0);else await chooseAddress(0);}
const sharedResetBeforeAddressTools=sharedReset;
sharedReset=function(){addressMatches=[];addressSearchCache.clear();alternateAddressCache.clear();addressSearchGeneration++;clearTimeout(addressSearchTimer);sharedResetBeforeAddressTools();};
