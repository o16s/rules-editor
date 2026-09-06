// The example file the editor opens with when the host gives it nothing:
// the six rules of the design handoff, one per sheet feature.
export function exampleModel() {
    const rule = (r) => ({
        variables: [],
        match: 'any',
        conditions: [],
        actions: [],
        incident: null,
        ...r,
    });
    return {
        rules: [
            rule({
                name: 'alarm-camera',
                cooldown: '45s',
                edge: 'rising',
                variables: [
                    { name: 'alarm_active', formula: 'TAG("plc1", "AlarmActive")', description: 'Cell 3 PLC has set its own alarm bit' },
                    { name: 'temp', formula: 'TAG("vibration1", "temperature")', description: 'Press motor housing temperature' },
                    { name: 'temp_rate', formula: 'RATE(temp, 30min)', description: 'How fast the housing is heating, over 30 min' },
                    { name: 'milk_temp', formula: 'TAG("bulk1", "milk_temperature")', description: 'Bulk tank 1 milk temperature' },
                    { name: 'door_changed', formula: 'CHANGED(TAG("bulk1", "door_state"))', description: 'Bulk tank 1 door opened or closed' },
                    { name: 'status_word', formula: 'TAG("plc1", "StatusWord")', description: 'Cell 3 PLC status register, 16 bits' },
                    { name: 'guard_open', formula: 'BITAND(status_word, 4) != 0', description: 'Bit 2 of the status word: guard door open' },
                    { name: 'in_manual', formula: 'BITAND(status_word, HEX2DEC("10")) != 0', description: 'Bit 4 of the status word: cell in manual mode' },
                    { name: 'alarm_byte', formula: 'TAG("plc1", "AlarmFlags")', description: 'Cell 3 PLC alarm flags, one bit per alarm' },
                    { name: 'any_plc_alarm', formula: 'BITAND(alarm_byte, HEX2DEC("FF")) != 0', description: 'At least one PLC alarm flag is raised' },
                ],
                conditions: [
                    { expr: 'alarm_active', description: 'Cell 3 PLC raised its own alarm' },
                    { expr: 'temp > 50', description: 'Housing above 50 °C' },
                    { expr: 'temp_rate > 4', description: 'Housing heating faster than 4 °C/h' },
                    { expr: 'AND(milk_temp > 3.6, door_changed)', description: 'Milk warm while the tank door moved' },
                    { expr: 'any_plc_alarm', description: 'Cell 3 PLC reports an alarm' },
                ],
                actions: [{ topic: 'camera/record', payload: '{"duration":40}' }],
                incident: {
                    source: 'Cell 3 press',
                    severity: 'critical',
                    summary: 'Press guard alarm on cell 3',
                    firstStep: 'Watch the 40 s camera clip before you open the cell.',
                    cause: '=condition.description & ". The press PLC set its own alarm bit. We read that bit and nothing upstream of it, so the reason sits in the PLC."',
                },
            }),
            rule({
                name: 'pump-overtemp',
                cooldown: '60s',
                edge: 'rising',
                variables: [
                    { name: 'vrms_alert', formula: 'TAG("vibration1", "alert_vrms_max")', description: 'Sensor vibration alert bit' },
                    { name: 'temp', formula: 'TAG("vibration1", "temperature")', description: 'Pump housing temperature' },
                ],
                match: 'all',
                conditions: [
                    { expr: 'vrms_alert', description: 'Vibration above the sensor limit' },
                    { expr: 'temp > 50.0', description: 'Housing above 50 °C' },
                ],
                incident: { source: 'vibration1', severity: 'error', summary: 'Pump 1 vibrates while hot', firstStep: 'Stop pump 1 and check the bearing.' },
            }),
            rule({
                name: 'wetwell-highlevel',
                cooldown: '5m',
                edge: 'rising',
                variables: [{ name: 'level', formula: 'TAG("wetwell", "level")', description: 'Wet well level' }],
                conditions: [{ expr: 'level > 3.6', description: 'Wet well above 3.6 m' }],
                actions: [{ topic: 'pumps/start', payload: '{"pump":2}' }],
                incident: { source: 'wetwell', severity: 'critical', summary: 'Wet well high level', firstStep: 'Check that pump 2 started.' },
            }),
            rule({
                name: 'weekly-flow-total',
                variables: [{ name: 'flow', formula: 'TAG("flowmeter1", "total")', description: 'Flow meter totaliser' }],
                conditions: [{ expr: 'CHANGED(flow)', description: 'Totaliser updated' }],
                actions: [{ topic: 'reports/flow', payload: '=flow' }],
            }),
            rule({
                name: 'firmware-updated',
                variables: [{ name: 'version', formula: 'TAG("plc1", "FirmwareVersion")', description: 'PLC firmware version string' }],
                conditions: [{ expr: 'CHANGED(version)', description: 'PLC reports a new firmware version' }],
                actions: [{ topic: 'events/firmware', payload: '=version' }],
            }),
            rule({
                name: 'bulk1-milk-temp',
                cooldown: '10m',
                edge: 'rising',
                variables: [{ name: 'milk_temp', formula: 'TAG("bulk1", "milk_temperature")', description: 'Bulk tank 1 milk temperature' }],
                conditions: [{ expr: 'milk_temp > 4', description: 'Milk above 4 °C' }],
                incident: { source: 'bulk1', severity: 'warning', summary: 'Bulk tank 1 milk too warm', firstStep: 'Check the cooling compressor.' },
            }),
        ],
    };
}
//# sourceMappingURL=example.js.map