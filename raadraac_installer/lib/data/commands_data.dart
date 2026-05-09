import '../models/command_model.dart';
import '../models/command_field_model.dart';

class CommandsData {
  static const List<CommandModel> commands = [
    // ─── SYSTEM ───────────────────────────────────────────────
    CommandModel(
      id: 'sys_reboot',
      name: 'Reboot',
      nameSo: 'Dib u bilow',
      description: 'Remotely reboot the GPS device',
      descriptionSo: 'GPS qalabka dib u bilow fog',
      category: CommandCategory.system,
      template: 'reboot',
      requiresPassword: false,
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
      isDangerous: false,
    ),

    CommandModel(
      id: 'sys_getinfo',
      name: 'Get Info',
      nameSo: 'Hel Macluumaadka',
      description: 'Get device information and status',
      descriptionSo: 'Hel macluumaadka iyo xaaladda qalabka',
      category: CommandCategory.system,
      template: 'getinfo',
      requiresPassword: false,
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'sys_getver',
      name: 'Get Version',
      nameSo: 'Hel Nooca',
      description: 'Get firmware version information',
      descriptionSo: 'Hel macluumaadka nooca firmware',
      category: CommandCategory.system,
      template: 'getver',
      requiresPassword: false,
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'sys_factory_reset',
      name: 'Factory Reset',
      nameSo: 'Dib u habeyn',
      description: 'Reset device to factory defaults. WARNING: This will erase all settings!',
      descriptionSo: 'Dib u habeyn qalabka. DIGDAIMO: Dhammaan dejintii ayaa tirtirmi doonta!',
      category: CommandCategory.system,
      template: 'cpureset',
      requiresPassword: true,
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
      isDangerous: true,
      dangerMessage: 'This will erase ALL device settings and cannot be undone.',
    ),

    CommandModel(
      id: 'sys_flush',
      name: 'Flush Data',
      nameSo: 'Nadiifi Xogta',
      description: 'Force send cached records to server',
      descriptionSo: 'Ku qasab dir xogta kaydsan server-ka',
      category: CommandCategory.system,
      template: 'flush',
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'sys_get_record',
      name: 'Get Record Count',
      nameSo: 'Hel Tirada Diiwaanka',
      description: 'Get the number of unsent records',
      descriptionSo: 'Hel tirada diiwaanada aan la dirin',
      category: CommandCategory.system,
      template: 'getrecord',
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    // ─── NETWORK ──────────────────────────────────────────────
    CommandModel(
      id: 'net_set_apn',
      name: 'Set APN',
      nameSo: 'Dejiso APN',
      description: 'Configure mobile data APN settings',
      descriptionSo: 'Dejiso dejinta APN ee xogta gawaarida',
      category: CommandCategory.network,
      template: 'setparam 2001:{apn} 2002:{apn_username} 2003:{apn_password}',
      fields: [
        CommandField(
          key: 'apn',
          label: 'APN Name',
          labelSo: 'Magaca APN',
          type: FieldType.text,
          hint: 'e.g. internet, web.vodafone.com',
          hintSo: 'tusaale: internet',
          required: true,
        ),
        CommandField(
          key: 'apn_username',
          label: 'APN Username',
          labelSo: 'Magaca Isticmaale APN',
          type: FieldType.text,
          hint: 'Leave blank if not required',
          hintSo: 'Ka tag maran hadaan loo baahnayn',
          required: false,
          defaultValue: '',
        ),
        CommandField(
          key: 'apn_password',
          label: 'APN Password',
          labelSo: 'Furaha APN',
          type: FieldType.text,
          hint: 'Leave blank if not required',
          hintSo: 'Ka tag maran hadaan loo baahnayn',
          required: false,
          defaultValue: '',
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'net_set_server',
      name: 'Set Server',
      nameSo: 'Dejiso Server-ka',
      description: 'Set the tracking server IP/domain and port',
      descriptionSo: 'Dejiso IP/domain iyo dekedda server-ka raadraaca',
      category: CommandCategory.network,
      template: 'setparam 2004:{server} 2005:{port}',
      fields: [
        CommandField(
          key: 'server',
          label: 'Server Address',
          labelSo: 'Cinwaanka Server-ka',
          type: FieldType.text,
          hint: 'IP or domain, e.g. track.somtel.net',
          hintSo: 'IP ama domain, tusaale: track.somtel.net',
          required: true,
        ),
        CommandField(
          key: 'port',
          label: 'Port',
          labelSo: 'Dekedda',
          type: FieldType.number,
          hint: 'e.g. 21212',
          hintSo: 'tusaale: 21212',
          required: true,
          maxLength: 5,
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'net_set_backup_server',
      name: 'Set Backup Server',
      nameSo: 'Dejiso Server-ka Kaydka',
      description: 'Set a secondary/backup tracking server',
      descriptionSo: 'Dejiso server-ka raadraaca ee kaydka',
      category: CommandCategory.network,
      template: 'setparam 2006:{server} 2007:{port}',
      fields: [
        CommandField(
          key: 'server',
          label: 'Backup Server Address',
          labelSo: 'Cinwaanka Server-ka Kaydka',
          type: FieldType.text,
          hint: 'IP or domain',
          hintSo: 'IP ama domain',
          required: true,
        ),
        CommandField(
          key: 'port',
          label: 'Backup Port',
          labelSo: 'Dekedda Kaydka',
          type: FieldType.number,
          hint: 'e.g. 21212',
          hintSo: 'tusaale: 21212',
          required: true,
          maxLength: 5,
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'net_set_protocol',
      name: 'Set Protocol',
      nameSo: 'Dejiso Borotokoolka',
      description: 'Switch between TCP and UDP protocol',
      descriptionSo: 'Rog dhexda TCP iyo UDP',
      category: CommandCategory.network,
      template: 'setparam 2009:{protocol}',
      fields: [
        CommandField(
          key: 'protocol',
          label: 'Protocol',
          labelSo: 'Borotokoolka',
          type: FieldType.dropdown,
          options: ['0', '1'],
          hint: '0=TCP, 1=UDP',
          hintSo: '0=TCP, 1=UDP',
          required: true,
          defaultValue: '0',
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'net_get_params',
      name: 'Get Network Params',
      nameSo: 'Hel Xogta Shabakadda',
      description: 'Get current network configuration',
      descriptionSo: 'Hel habaynta shabakadda hadda jirta',
      category: CommandCategory.network,
      template: 'getparam 2001 2004 2005 2006',
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    // ─── TRACKING ─────────────────────────────────────────────
    CommandModel(
      id: 'track_min_period',
      name: 'Set Min Period',
      nameSo: 'Dejiso Xilliga Ugu Yar',
      description: 'Set minimum record saving period (seconds)',
      descriptionSo: 'Dejiso xilliga kaydinta diiwaanka ugu yar (ilbiriqsiyo)',
      category: CommandCategory.tracking,
      template: 'setparam 10001:{seconds}',
      fields: [
        CommandField(
          key: 'seconds',
          label: 'Interval (seconds)',
          labelSo: 'Xilliga (ilbiriqsiyo)',
          type: FieldType.number,
          hint: 'e.g. 30 (30 seconds)',
          hintSo: 'tusaale: 30 (30 ilbiriqsi)',
          required: true,
          suffix: 'sec',
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'track_send_period',
      name: 'Set Send Period',
      nameSo: 'Dejiso Xilliga Dirista',
      description: 'Set how often device sends data to server (seconds)',
      descriptionSo: 'Dejiso intee jeer qalabku xogta server-ka u diro (ilbiriqsiyo)',
      category: CommandCategory.tracking,
      template: 'setparam 10002:{seconds}',
      fields: [
        CommandField(
          key: 'seconds',
          label: 'Send Period (seconds)',
          labelSo: 'Xilliga Dirista (ilbiriqsiyo)',
          type: FieldType.number,
          hint: 'e.g. 60 (every minute)',
          hintSo: 'tusaale: 60 (hal daqiiqo walba)',
          required: true,
          suffix: 'sec',
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'track_on_move',
      name: 'Set Moving Interval',
      nameSo: 'Dejiso Xilliga Socotada',
      description: 'Set tracking interval when vehicle is moving',
      descriptionSo: 'Dejiso xilliga raadraaca markii baabuurku socdo',
      category: CommandCategory.tracking,
      template: 'setparam 10001:{moving} 10003:{stopped}',
      fields: [
        CommandField(
          key: 'moving',
          label: 'Moving Interval (sec)',
          labelSo: 'Xilliga Socotada (ilbiriqsi)',
          type: FieldType.number,
          hint: 'e.g. 30',
          hintSo: 'tusaale: 30',
          required: true,
          suffix: 'sec',
        ),
        CommandField(
          key: 'stopped',
          label: 'Stopped Interval (sec)',
          labelSo: 'Xilliga Joogitaanka (ilbiriqsi)',
          type: FieldType.number,
          hint: 'e.g. 300',
          hintSo: 'tusaale: 300',
          required: true,
          suffix: 'sec',
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'track_ignition_source',
      name: 'Ignition Source',
      nameSo: 'Isha Ignition',
      description: 'Set the ignition detection source',
      descriptionSo: 'Dejiso isha ogaanshaha ignition',
      category: CommandCategory.tracking,
      template: 'setparam 10200:{source}',
      fields: [
        CommandField(
          key: 'source',
          label: 'Ignition Source',
          labelSo: 'Isha Ignition',
          type: FieldType.dropdown,
          options: ['0', '1', '2', '3', '4', '5'],
          hint: '0=Ignition, 1=Din1, 2=Movement, 3=Current, 4=AccAvg, 5=CAN',
          hintSo: '0=Ignition, 1=Din1, 2=Dhaqdhaqaaqa, 3=Korantada',
          required: true,
          defaultValue: '0',
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'track_roaming',
      name: 'Roaming Settings',
      nameSo: 'Dejinta Roaming',
      description: 'Enable or disable data roaming',
      descriptionSo: 'Fur ama xidh xogta roaming',
      category: CommandCategory.tracking,
      template: 'setparam 2000:{roaming}',
      fields: [
        CommandField(
          key: 'roaming',
          label: 'Roaming',
          labelSo: 'Roaming',
          type: FieldType.dropdown,
          options: ['0', '1', '2'],
          hint: '0=Disabled, 1=Enabled, 2=Use Roaming APN',
          hintSo: '0=Xiran, 1=Furan, 2=Isticmaal APN Roaming',
          required: true,
          defaultValue: '0',
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'track_sleep_mode',
      name: 'Sleep Mode',
      nameSo: 'Habka Hurda',
      description: 'Configure device sleep mode to save power',
      descriptionSo: 'Habeyn habka hurda qalabka si aad tamar uga badbaadiso',
      category: CommandCategory.tracking,
      template: 'setparam 10050:{mode}',
      fields: [
        CommandField(
          key: 'mode',
          label: 'Sleep Mode',
          labelSo: 'Habka Hurda',
          type: FieldType.dropdown,
          options: ['0', '1', '2', '3'],
          hint: '0=Disabled, 1=GPS Sleep, 2=Deep Sleep, 3=Online Deep Sleep',
          hintSo: '0=Xiran, 1=GPS Hurdada, 2=Hurdo Qoto Dheer',
          required: true,
          defaultValue: '0',
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'track_get_gps',
      name: 'Get GPS Status',
      nameSo: 'Hel Xaaladda GPS',
      description: 'Get current GPS location and status',
      descriptionSo: 'Hel goobta GPS-ka iyo xaaladda hadda',
      category: CommandCategory.tracking,
      template: 'ggps',
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    // ─── OUTPUTS ──────────────────────────────────────────────
    CommandModel(
      id: 'out_engine_cut',
      name: 'Engine Cut',
      nameSo: 'Jari Matoorka',
      description: 'Remotely cut the engine (DOUT1 ON)',
      descriptionSo: 'Fog u jar matoorka (DOUT1 SHID)',
      category: CommandCategory.outputs,
      template: 'setdigout 1?1:0',
      requiresPassword: false,
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
      isDangerous: true,
      dangerMessage: 'This will cut the engine remotely. Only use when vehicle is stationary.',
    ),

    CommandModel(
      id: 'out_engine_restore',
      name: 'Engine Restore',
      nameSo: 'Soo Celiso Matoorka',
      description: 'Restore engine (DOUT1 OFF)',
      descriptionSo: 'Soo celiso matoorka (DOUT1 DEMIS)',
      category: CommandCategory.outputs,
      template: 'setdigout 0?1:0',
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'out_dout1',
      name: 'Digital Output 1',
      nameSo: 'Wax Soo Saarka Tirakoobka 1',
      description: 'Set digital output 1 state',
      descriptionSo: 'Dejiso xaaladda wax soo saarka tirakoobka 1',
      category: CommandCategory.outputs,
      template: 'setdigout {state}?1:0',
      fields: [
        CommandField(
          key: 'state',
          label: 'State',
          labelSo: 'Xaaladda',
          type: FieldType.dropdown,
          options: ['1', '0'],
          hint: '1=ON, 0=OFF',
          hintSo: '1=SHID, 0=DEMIS',
          required: true,
          defaultValue: '1',
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'out_dout2',
      name: 'Digital Output 2',
      nameSo: 'Wax Soo Saarka Tirakoobka 2',
      description: 'Set digital output 2 state',
      descriptionSo: 'Dejiso xaaladda wax soo saarka tirakoobka 2',
      category: CommandCategory.outputs,
      template: 'setdigout {state}?2:0',
      fields: [
        CommandField(
          key: 'state',
          label: 'State',
          labelSo: 'Xaaladda',
          type: FieldType.dropdown,
          options: ['1', '0'],
          hint: '1=ON, 0=OFF',
          hintSo: '1=SHID, 0=DEMIS',
          required: true,
          defaultValue: '1',
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'out_buzzer',
      name: 'Buzzer',
      nameSo: 'Buzzer',
      description: 'Activate buzzer/horn relay output',
      descriptionSo: 'Shid buzzer/gaadhiga wax soo saarka',
      category: CommandCategory.outputs,
      template: 'setdigout 1?3:0 {duration}000',
      fields: [
        CommandField(
          key: 'duration',
          label: 'Duration (seconds)',
          labelSo: 'Muddada (ilbiriqsiyo)',
          type: FieldType.number,
          hint: 'e.g. 5 (5 seconds)',
          hintSo: 'tusaale: 5 (5 ilbiriqsi)',
          required: true,
          defaultValue: '5',
          suffix: 'sec',
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'out_relay_on',
      name: 'Relay ON',
      nameSo: 'Relay Shid',
      description: 'Turn relay output ON',
      descriptionSo: 'Shid wax soo saarka relay-ka',
      category: CommandCategory.outputs,
      template: 'setdigout 1',
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    CommandModel(
      id: 'out_relay_off',
      name: 'Relay OFF',
      nameSo: 'Relay Demis',
      description: 'Turn relay output OFF',
      descriptionSo: 'Demis wax soo saarka relay-ka',
      category: CommandCategory.outputs,
      template: 'setdigout 0',
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    ),

    // ─── BLUETOOTH ────────────────────────────────────────────
    CommandModel(
      id: 'ble_scan',
      name: 'BLE Scan',
      nameSo: 'Raadi BLE',
      description: 'Scan for nearby Bluetooth Low Energy devices',
      descriptionSo: 'Raadi qalabka Bluetooth Low Energy ee dhow',
      category: CommandCategory.bluetooth,
      template: 'blescan',
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMB120'],
    ),

    CommandModel(
      id: 'ble_enable',
      name: 'Enable Bluetooth',
      nameSo: 'Fur Bluetooth',
      description: 'Enable Bluetooth module on device',
      descriptionSo: 'Fur moduulka Bluetooth ee qalabka',
      category: CommandCategory.bluetooth,
      template: 'setparam 11000:1',
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMB120'],
    ),

    CommandModel(
      id: 'ble_disable',
      name: 'Disable Bluetooth',
      nameSo: 'Xidh Bluetooth',
      description: 'Disable Bluetooth module on device',
      descriptionSo: 'Xidh moduulka Bluetooth ee qalabka',
      category: CommandCategory.bluetooth,
      template: 'setparam 11000:0',
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMB120'],
    ),

    CommandModel(
      id: 'ble_pair',
      name: 'Pair BLE Sensor',
      nameSo: 'Kujowso Sensor BLE',
      description: 'Pair a Bluetooth sensor by MAC address',
      descriptionSo: 'Kujow sensor Bluetooth adiga oo isticmaalaya cinwaanka MAC',
      category: CommandCategory.bluetooth,
      template: 'setparam 11002.1:{mac}',
      fields: [
        CommandField(
          key: 'mac',
          label: 'Sensor MAC Address',
          labelSo: 'Cinwaanka MAC ee Sensor-ka',
          type: FieldType.text,
          hint: 'e.g. AA:BB:CC:DD:EE:FF',
          hintSo: 'tusaale: AA:BB:CC:DD:EE:FF',
          required: true,
          validationPattern: r'^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$',
        ),
      ],
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMB120'],
    ),

    CommandModel(
      id: 'ble_get_status',
      name: 'BLE Status',
      nameSo: 'Xaaladda BLE',
      description: 'Get Bluetooth module status and connected sensors',
      descriptionSo: 'Hel xaaladda moduulka Bluetooth iyo sensarrada xiddan',
      category: CommandCategory.bluetooth,
      template: 'getparam 11000 11002',
      supportedModels: ['FMC130', 'FMB920', 'FMC650', 'FMB120'],
    ),
  ];

  static List<CommandModel> getByCategory(CommandCategory category) {
    return commands.where((c) => c.category == category).toList();
  }

  static List<CommandModel> getByModel(String modelId) {
    return commands.where((c) => c.supportedModels.contains(modelId)).toList();
  }

  static List<CommandModel> search(String query) {
    final q = query.toLowerCase();
    return commands.where((c) {
      return c.name.toLowerCase().contains(q) ||
          c.nameSo.toLowerCase().contains(q) ||
          c.description.toLowerCase().contains(q) ||
          c.category.name.toLowerCase().contains(q);
    }).toList();
  }

  static CommandModel? getById(String id) {
    try {
      return commands.firstWhere((c) => c.id == id);
    } catch (_) {
      return null;
    }
  }
}

// Server presets
class ServerPresets {
  static const List<Map<String, dynamic>> presets = [
    {
      'name': 'Wialon',
      'host': 'wialon.com',
      'port': '21212',
      'description': 'Gurtam Wialon Platform',
    },
    {
      'name': 'GPSWOX',
      'host': 'gpswox.com',
      'port': '21212',
      'description': 'GPSWOX Tracking Platform',
    },
    {
      'name': 'Traccar',
      'host': 'demo.traccar.org',
      'port': '5027',
      'description': 'Traccar Open Source Platform',
    },
    {
      'name': 'Navixy',
      'host': 'track.navixy.com',
      'port': '21212',
      'description': 'Navixy Tracking Platform',
    },
  ];
}
