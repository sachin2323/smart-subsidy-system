/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* global getParticipantRegistry getAssetRegistry getFactory emit */

/**
 * A shipment has been received by an importer
 * @param {org.smart.subsidy.system.ShipmentReceived} shipmentReceived - the ShipmentReceived transaction
 * @transaction
 */
async function receiveShipment(shipmentReceived) {  // eslint-disable-line no-unused-vars

    const contract = shipmentReceived.shipment.contract;
    const shipment = shipmentReceived.shipment;
    let payOut = contract.unitPrice * shipment.unitCount;

    console.log('Received at: ' + shipmentReceived.timestamp);
    console.log('Contract arrivalDateTime: ' + contract.arrivalDateTime);

    // set the status of the shipment
    shipment.status = 'ARRIVED';

    // if the shipment did not arrive on time the payout is zero
    if (shipmentReceived.timestamp > contract.arrivalDateTime) {
        payOut = 0;
        console.log('Late shipment');
    } else {
        // find the lowest temperature reading
        if (shipment.temperatureReadings) {
            // sort the temperatureReadings by centigrade
            shipment.temperatureReadings.sort(function (a, b) {
                return (a.centigrade - b.centigrade);
            });
            const lowestReading = shipment.temperatureReadings[0];
            const highestReading = shipment.temperatureReadings[shipment.temperatureReadings.length - 1];
            let penalty = 0;
            console.log('Lowest temp reading: ' + lowestReading.centigrade);
            console.log('Highest temp reading: ' + highestReading.centigrade);

            // does the lowest temperature violate the contract?
            if (lowestReading.centigrade < contract.minTemperature) {
                penalty += (contract.minTemperature - lowestReading.centigrade) * contract.minPenaltyFactor;
                console.log('Min temp penalty: ' + penalty);
            }

            // does the highest temperature violate the contract?
            if (highestReading.centigrade > contract.maxTemperature) {
                penalty += (highestReading.centigrade - contract.maxTemperature) * contract.maxPenaltyFactor;
                console.log('Max temp penalty: ' + penalty);
            }

            // apply any penalities
            payOut -= (penalty * shipment.unitCount);

            if (payOut < 0) {
                payOut = 0;
            }
        }
    }

    console.log('Payout: ' + payOut);
    contract.importer.accountBalance -= payOut;
    contract.shipper.accountBalance -= pauOut;

    console.log('Importer: ' + contract.importer.$identifier + ' new balance: ' + contract.importer.accountBalance);
    console.log('Shipper: ' + contract.shipper.$identifier + ' new balance: ' + contract.shipper.accountBalance);

    var NS = 'org.smart.subsidy.system';
    // Store the ShipmentReceived transaction with the Shipment asset it belongs to
    shipment.shipmentReceived = shipmentReceived;

    var factory = getFactory();
    var shipmentReceivedEvent = factory.newEvent(NS, 'ShipmentReceivedEvent');
    var message = 'Shipment ' + shipment.$identifier + ' received';
    console.log(message);
    shipmentReceivedEvent.message = message;
    shipmentReceivedEvent.shipment = shipment;
    emit(shipmentReceivedEvent);

    // update the shiper's balance
    const growerRegistry = await getParticipantRegistry('org.smart.subsidy.system.Shipper');
    await growerRegistry.update(contract.shipper);

    // update the importer's balance
    const importerRegistry = await getParticipantRegistry('org.smart.subsidy.system.Importer');
    await importerRegistry.update(contract.importer);

    // update the state of the shipment
    const shipmentRegistry = await getAssetRegistry('org.smart.subsidy.system.Shipment');
    await shipmentRegistry.update(shipment);
}

/**
 * A temperature reading has been received for a shipment
 * @param {org.smart.subsidy.system.TemperatureReading} temperatureReading - the TemperatureReading transaction
 * @transaction
 */
async function temperatureReading(temperatureReading) {  // eslint-disable-line no-unused-vars

    const NS = 'org.smart.subsidy.system';
    const shipment = temperatureReading.shipment;
    const contract = shipment.contract;
    const factory = getFactory();

    console.log('Adding temperature ' + temperatureReading.centigrade + ' to shipment ' + shipment.$identifier);

    if (shipment.temperatureReadings) {
        shipment.temperatureReadings.push(temperatureReading);
    } else {
        shipment.temperatureReadings = [temperatureReading];
    }

    if (temperatureReading.centigrade < contract.minTemperature ||
        temperatureReading.centigrade > contract.maxTemperature) {
        var temperatureEvent = factory.newEvent(NS, 'TemperatureThresholdEvent');
        temperatureEvent.shipment = shipment;
        temperatureEvent.temperature = temperatureReading.centigrade;
        temperatureEvent.message = 'Temperature threshold violated! Emitting TemperatureEvent for shipment: ' + shipment.$identifier;
        console.log(temperatureEvent.message);
        emit(temperatureEvent);
    }

    // add the temp reading to the shipment
    const shipmentRegistry = await getAssetRegistry(NS + '.Shipment');
    await shipmentRegistry.update(shipment);
}

/**
 * A GPS reading has been received for a shipment
 * @param {org.smart.subsidy.system.GpsReading} gpsReading - the GpsReading transaction
 * @transaction
 */
async function gpsReading(gpsReading) {  // eslint-disable-line no-unused-vars

    var factory = getFactory();
    var NS = 'org.smart.subsidy.system';
    var shipment = gpsReading.shipment;
    var PORT = '/LAT:40.6840N/LONG:74.0062W';

    var latLong = '/LAT:' + gpsReading.latitude + gpsReading.latitudeDir + '/LONG:' +
        gpsReading.longitude + gpsReading.longitudeDir;

    if (shipment.gpsReadings) {
        shipment.gpsReadings.push(gpsReading);
    } else {
        shipment.gpsReadings = [gpsReading];
    }

    if (latLong === PORT) {
        var shipmentInPortEvent = factory.newEvent(NS, 'ShipmentInPortEvent');
        shipmentInPortEvent.shipment = shipment;
        var message = 'Shipment has reached the destination port of ' + PORT;
        shipmentInPortEvent.message = message;
        console.log(message);
        emit(shipmentInPortEvent);
    }

    const shipmentRegistry = await getAssetRegistry(NS + '.Shipment');
    await shipmentRegistry.update(shipment);
}

/**
 * ShipmentPacked transaction - invoked when the Shipment is packed and ready for pickup.
 *
 * @param {org.smart.subsidy.system.ShipmentPacked} shipmentPacked - the ShipmentPacked transaction
 * @transaction
 */
async function packShipment(shipmentPacked) {  // eslint-disable-line no-unused-vars
    var shipment = shipmentPacked.shipment;
    var NS = 'org.smart.subsidy.system';
    var factory = getFactory();

    // Add the ShipmentPacked transaction to the ledger (via the Shipment asset)
    shipment.shipmentPacked = shipmentPacked;

    // Create the message
    var message = 'Shipment packed for shipment ' + shipment.$identifier;

    // Log it to the JavaScript console
    //console.log(message);

    // Emit a notification telling subscribed listeners that the shipment has been packed
    var shipmentPackedEvent = factory.newEvent(NS, 'ShipmentPackedEvent');
    shipmentPackedEvent.shipment = shipment;
    shipmentPackedEvent.message = message;
    emit(shipmentPackedEvent);

    // Update the Asset Registry
    const shipmentRegistry = await getAssetRegistry(NS + '.Shipment');
    await shipmentRegistry.update(shipment);
}

/**
 * ShipmentPickup - invoked when the Shipment has been picked up from the packer.
 *
 * @param {org.smart.subsidy.system.ShipmentPickup} shipmentPickup - the ShipmentPickup transaction
 * @transaction
 */
async function pickupShipment(shipmentPickup) {  // eslint-disable-line no-unused-vars
    var shipment = shipmentPickup.shipment;
    var NS = 'org.smart.subsidy.system';
    var factory = getFactory();

    // Add the ShipmentPacked transaction to the ledger (via the Shipment asset)
    shipment.shipmentPickup = shipmentPickup;

    // Create the message
    var message = 'Shipment picked up for shipment ' + shipment.$identifier;

    // Log it to the JavaScript console
    //console.log(message);

    // Emit a notification telling subscribed listeners that the shipment has been packed
    var shipmentPickupEvent = factory.newEvent(NS, 'ShipmentPickupEvent');
    shipmentPickupEvent.shipment = shipment;
    shipmentPickupEvent.message = message;
    emit(shipmentPickupEvent);

    // Update the Asset Registry
    const shipmentRegistry = await getAssetRegistry(NS + '.Shipment');
    await shipmentRegistry.update(shipment);
}

/**
 * ShipmentLoaded - invoked when the Shipment has been loaded onto the container ship.
 *
 * @param {org.smart.subsidy.system.ShipmentLoaded} shipmentLoaded - the ShipmentLoaded transaction
 * @transaction
 */
async function loadShipment(shipmentLoaded) { // eslint-disable-line no-unused-vars
    var shipment = shipmentLoaded.shipment;
    var NS = 'org.smart.subsidy.system';
    var factory = getFactory();

    // Add the ShipmentPacked transaction to the ledger (via the Shipment asset)
    shipment.shipmentLoaded = shipmentLoaded;

    // Create the message
    var message = 'Shipment loaded for shipment ' + shipment.$identifier;

    // Log it to the JavaScript console
    //console.log(message);

    // Emit a notification telling subscribed listeners that the shipment has been packed
    var shipmentLoadedEvent = factory.newEvent(NS, 'ShipmentLoadedEvent');
    shipmentLoadedEvent.shipment = shipment;
    shipmentLoadedEvent.message = message;
    emit(shipmentLoadedEvent);

    // Update the Asset Registry
    const shipmentRegistry = await getAssetRegistry(NS + '.Shipment');
    await shipmentRegistry.update(shipment);
}

/**
 * Track the trade of a commodity from one trader to another
 * @param {org.smart.subsidy.system.Trade} trade - the trade to be processed
 * @transaction
 */
async function tradeCommodity(trade) { // eslint-disable-line no-unused-vars

    // set the new owner of the commodity
    trade.shipment.owner = trade.newOwner;
    const assetRegistry = await getAssetRegistry('org.smart.subsidy.system.Shipment');

    // emit a notification that a trade has occurred
    const tradeNotification = getFactory().newEvent('org.smart.subsidy.system', 'TradeNotification');
    tradeNotification.shipment = trade.shipment;
    emit(tradeNotification);

    // persist the state of the commodity
    await assetRegistry.update(trade.shipment);
}