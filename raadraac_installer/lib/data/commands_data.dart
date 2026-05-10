import '../models/command_model.dart';
import '../models/command_field_model.dart';

const _all = ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'];
const _btModels = ['FMC130', 'FMB920', 'FMC650', 'FMB120'];

class CommandsData {
  static const List<CommandModel> commands = [

    // ══════════════════════════════════════════════════════════════
    // SYSTEM — Info & Status
    // ══════════════════════════════════════════════════════════════

    CommandModel(
      id: 'sys_getinfo',
      name: 'Get Info',
      nameSo: 'Hel Macluumaadka',
      description: 'Device runtime system information',
      descriptionSo: 'Macluumaadka nidaamka qalabka',
      category: CommandCategory.system,
      template: 'getinfo',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_getver',
      name: 'Get Version',
      nameSo: 'Hel Nooca',
      description: 'Firmware version, IMEI, modem version, RTC time, uptime, BT MAC',
      descriptionSo: 'Nooca firmware, IMEI, nooca modem, waqtiga RTC, BT MAC',
      category: CommandCategory.system,
      template: 'getver',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_getstatus',
      name: 'Get Status',
      nameSo: 'Hel Xaaladda',
      description: 'Modem status information',
      descriptionSo: 'Xogta xaaladda modem-ka',
      category: CommandCategory.system,
      template: 'getstatus',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_getgps',
      name: 'Get GPS Data',
      nameSo: 'Hel Xogta GPS',
      description: 'Current GPS data, date and time',
      descriptionSo: 'Xogta GPS-ka hadda, taariikhda iyo waqtiga',
      category: CommandCategory.system,
      template: 'getgps',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_ggps',
      name: 'Get GPS Link',
      nameSo: 'Hel Xiriirka GPS',
      description: 'Location with Google Maps link',
      descriptionSo: 'Goobta iyo xiriirka Google Maps',
      category: CommandCategory.system,
      template: 'ggps',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_getio',
      name: 'Get I/O',
      nameSo: 'Hel Gelinta/Saarista',
      description: 'Read analog input, digital input and output states',
      descriptionSo: 'Akhri xaaladda gelinta analog, gelinta tirakoobka iyo saarista',
      category: CommandCategory.system,
      template: 'getio',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_readio',
      name: 'Read IO',
      nameSo: 'Akhri IO',
      description: 'Returns IO status by AVL ID',
      descriptionSo: 'Soo celi xaaladda IO ee aqoonsiga AVL',
      category: CommandCategory.system,
      template: 'readio {avl_id}',
      fields: [
        CommandField(
          key: 'avl_id',
          label: 'AVL ID',
          labelSo: 'Aqoonsiga AVL',
          type: FieldType.number,
          hint: 'e.g. 239',
          hintSo: 'tusaale: 239',
          required: true,
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_fwstats',
      name: 'FW Stats',
      nameSo: 'Xogta FW',
      description: 'Get data about firmware and restarts',
      descriptionSo: 'Hel xogta firmware iyo bilowyada dib u bilaabka',
      category: CommandCategory.system,
      template: 'fwstats',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_allver',
      name: 'All Versions',
      nameSo: 'Dhammaan Noocyada',
      description: 'Hardware and firmware versions and storage space',
      descriptionSo: 'Noocyada hardware, firmware iyo booska kaydinta',
      category: CommandCategory.system,
      template: 'allver',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_battery',
      name: 'Battery Info',
      nameSo: 'Xogta Baatarida',
      description: 'Returns battery state and charge info',
      descriptionSo: 'Soo celi xaaladda baatarida iyo xogta shidaalka',
      category: CommandCategory.system,
      template: 'battery',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_wdlog',
      name: 'Watch Dog Log',
      nameSo: 'Diiwaanka Watch Dog',
      description: 'Returns all information about watch dogs',
      descriptionSo: 'Soo celi dhammaan macluumaadka watch dogs',
      category: CommandCategory.system,
      template: 'wdlog',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_countrecs',
      name: 'Count Records',
      nameSo: 'Tiri Diiwaanada',
      description: 'Returns number of unsent records in device memory',
      descriptionSo: 'Soo celi tirada diiwaanada aan la dirin ee xusuusta qalabka',
      category: CommandCategory.system,
      template: 'countrecs',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_getimsi',
      name: 'Get IMSI',
      nameSo: 'Hel IMSI',
      description: 'Get IMSI number of the active SIM card',
      descriptionSo: 'Hel lambarka IMSI ee kaarka SIM ee firfircoon',
      category: CommandCategory.system,
      template: 'getimsi',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_getimeiccid',
      name: 'Get IMEI & ICCID',
      nameSo: 'Hel IMEI & ICCID',
      description: 'Get IMEI and ICCID — also sends response to the given number',
      descriptionSo: 'Hel IMEI iyo ICCID — sidoo kale u dir jawaabta lambarka la bixiyay',
      category: CommandCategory.system,
      template: 'getimeiccid {phone}',
      fields: [
        CommandField(
          key: 'phone',
          label: 'Forward to Number',
          labelSo: 'U dir Lambarka',
          type: FieldType.text,
          hint: 'e.g. +252612345678',
          hintSo: 'tusaale: +252612345678',
          required: true,
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_getops',
      name: 'Get Operators',
      nameSo: 'Hel Hawlwadeenada',
      description: 'Returns list of all currently visible operators',
      descriptionSo: 'Soo celi liiska dhammaan hawlwadeenada la arki karo',
      category: CommandCategory.system,
      template: 'getops',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_bbread',
      name: 'Black Box Read',
      nameSo: 'Akhri Sanduuqa Madow',
      description: 'Return black box events (HEX value of event ID and custom data)',
      descriptionSo: 'Soo celi xaaladaha sanduuqa madow (HEX)',
      category: CommandCategory.system,
      template: 'bbread {count}',
      fields: [
        CommandField(
          key: 'count',
          label: 'Number of Events',
          labelSo: 'Tirada Xaaladaha',
          type: FieldType.number,
          hint: 'Leave blank for latest pack',
          hintSo: 'Ka tag maran si aad u hesho kuwa ugu dambeeyay',
          required: false,
          defaultValue: '',
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_bbinfo',
      name: 'Black Box Info',
      nameSo: 'Macluumaadka Sanduuqa Madow',
      description: 'Same as Black Box Read but includes timestamp in HEX',
      descriptionSo: 'La mid ah bbread laakiin waxaa ku jira wakhtiga HEX',
      category: CommandCategory.system,
      template: 'bbinfo {count}',
      fields: [
        CommandField(
          key: 'count',
          label: 'Number of Events',
          labelSo: 'Tirada Xaaladaha',
          type: FieldType.number,
          hint: 'Leave blank for latest pack',
          hintSo: 'Ka tag maran si aad u hesho kuwa ugu dambeeyay',
          required: false,
          defaultValue: '',
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_getrecord',
      name: 'Get Record',
      nameSo: 'Hel Diiwaanka',
      description: 'Initiates saving and sending of a high priority record',
      descriptionSo: 'Billow kaydinta iyo dirista diiwaanka muhiimka ah',
      category: CommandCategory.system,
      template: 'getrecord',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_web_connect',
      name: 'Connect to FOTA',
      nameSo: 'Xidh FOTA',
      description: 'Force device to connect to FOTA WEB immediately',
      descriptionSo: 'Ku qasab qalabka inuu si degdeg ah ugu xidho FOTA WEB',
      category: CommandCategory.system,
      template: 'web_connect',
      supportedModels: _all,
    ),

    // ─── System — Configuration ────────────────────────────────

    CommandModel(
      id: 'sys_getparam',
      name: 'Get Parameter',
      nameSo: 'Hel Qaybta',
      description: 'Read one or more parameter values by ID',
      descriptionSo: 'Akhri qiimaha hal ama in kabadan qaybood adiga oo isticmaalaya aqoonsiga',
      category: CommandCategory.system,
      template: 'getparam {param_id}',
      fields: [
        CommandField(
          key: 'param_id',
          label: 'Parameter ID(s)',
          labelSo: 'Aqoonsiga Qaybta',
          type: FieldType.text,
          hint: 'e.g. 2001 or 2001 2004 2005',
          hintSo: 'tusaale: 2001 ama 2001 2004 2005',
          required: true,
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_setparam',
      name: 'Set Parameter',
      nameSo: 'Dejiso Qaybta',
      description: 'Set one or more parameter values. Format: ID:value;ID:value',
      descriptionSo: 'Dejiso qiimaha qaybaha. Qaabka: ID:qiimaha;ID:qiimaha',
      category: CommandCategory.system,
      template: 'setparam {param_id}:{value}',
      fields: [
        CommandField(
          key: 'param_id',
          label: 'Parameter ID',
          labelSo: 'Aqoonsiga Qaybta',
          type: FieldType.number,
          hint: 'e.g. 10001',
          hintSo: 'tusaale: 10001',
          required: true,
        ),
        CommandField(
          key: 'value',
          label: 'Value',
          labelSo: 'Qiimaha',
          type: FieldType.text,
          hint: 'New value',
          hintSo: 'Qiimaha cusub',
          required: true,
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_setkey',
      name: 'Set Keyword',
      nameSo: 'Dejiso Furaha Ereyga',
      description: 'Add new or change configuration keyword for SMS authentication',
      descriptionSo: 'Ku dar ama beddel furaha ereyga dejinta ee xaqiijinta SMS',
      category: CommandCategory.system,
      template: 'setkey {old_key} {new_key}',
      fields: [
        CommandField(
          key: 'old_key',
          label: 'Old Keyword',
          labelSo: 'Furaha Ereyga Hore',
          type: FieldType.text,
          hint: 'Current keyword (blank if none)',
          hintSo: 'Furaha hadda jira (maran hadaan jirin)',
          required: false,
          defaultValue: '',
        ),
        CommandField(
          key: 'new_key',
          label: 'New Keyword',
          labelSo: 'Furaha Ereyga Cusub',
          type: FieldType.text,
          hint: 'New keyword to set',
          hintSo: 'Furaha cusub ee la dejinayo',
          required: true,
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'sys_delkey',
      name: 'Delete Keyword',
      nameSo: 'Tir Furaha Ereyga',
      description: 'Remove existing SMS authentication keyword',
      descriptionSo: 'Ka saar furaha ereyga xaqiijinta SMS ee jira',
      category: CommandCategory.system,
      template: 'delkey {keyword}',
      fields: [
        CommandField(
          key: 'keyword',
          label: 'Keyword to Remove',
          labelSo: 'Furaha Ereyga La Tirayo',
          type: FieldType.text,
          hint: 'Current keyword',
          hintSo: 'Furaha hadda jira',
          required: true,
        ),
      ],
      supportedModels: _all,
    ),

    // ─── System — Dangerous ────────────────────────────────────

    CommandModel(
      id: 'sys_cpureset',
      name: 'Reset Device',
      nameSo: 'Dib u Bilow Qalabka',
      description: 'Remotely reset (reboot) the GPS device',
      descriptionSo: 'Fog u dib u bilow qalabka GPS',
      category: CommandCategory.system,
      template: 'cpureset',
      supportedModels: _all,
      isDangerous: true,
      dangerMessage: 'This will reboot the device. It will go offline for ~30 seconds.',
    ),

    CommandModel(
      id: 'sys_defaultcfg',
      name: 'Load Default Config',
      nameSo: 'Soo Fur Dejinta Asalka',
      description: 'Load default factory configuration — all custom settings will be lost',
      descriptionSo: 'Soo fur dejinta asalka — dhammaan dejimaha gaarka ah ayaa lumaya',
      category: CommandCategory.system,
      template: 'defaultcfg',
      supportedModels: _all,
      isDangerous: true,
      dangerMessage: 'This loads factory defaults. All custom configuration will be erased.',
    ),

    CommandModel(
      id: 'sys_deleterecords',
      name: 'Delete All Records',
      nameSo: 'Tir Dhammaan Diiwaanada',
      description: 'Delete all records from SD card',
      descriptionSo: 'Tir dhammaan diiwaanada kaarka SD',
      category: CommandCategory.system,
      template: 'deleterecords',
      supportedModels: _all,
      isDangerous: true,
      dangerMessage: 'All unsent records on the SD card will be permanently deleted.',
    ),

    CommandModel(
      id: 'sys_sdformat',
      name: 'Format SD Card',
      nameSo: 'Habee Kaarka SD',
      description: 'Format the SD card — all data will be erased',
      descriptionSo: 'Habee kaarka SD — dhammaan xogta ayaa tirtirmi doonta',
      category: CommandCategory.system,
      template: 'sdformat',
      supportedModels: _all,
      isDangerous: true,
      dangerMessage: 'This will FORMAT the SD card. All stored data will be permanently erased.',
    ),

    // ══════════════════════════════════════════════════════════════
    // NETWORK
    // ══════════════════════════════════════════════════════════════

    CommandModel(
      id: 'net_set_apn',
      name: 'Set APN',
      nameSo: 'Dejiso APN',
      description: 'Configure mobile data APN — param IDs 2001 / 2002 / 2003',
      descriptionSo: 'Dejiso APN ee xogta gawaarida — param 2001 / 2002 / 2003',
      category: CommandCategory.network,
      template: 'setparam 2001:{apn} 2002:{apn_username} 2003:{apn_password}',
      fields: [
        CommandField(
          key: 'apn',
          label: 'APN Name',
          labelSo: 'Magaca APN',
          type: FieldType.text,
          hint: 'e.g. internet',
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
      supportedModels: _all,
    ),

    CommandModel(
      id: 'net_set_server',
      name: 'Set Server',
      nameSo: 'Dejiso Server-ka',
      description: 'Set tracking server IP/domain and port — param IDs 2004 / 2005',
      descriptionSo: 'Dejiso IP/domain iyo dekedda server-ka — param 2004 / 2005',
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
      supportedModels: _all,
    ),

    CommandModel(
      id: 'net_set_backup_server',
      name: 'Set Backup Server',
      nameSo: 'Dejiso Server-ka Kaydka',
      description: 'Set secondary/backup tracking server — param IDs 2006 / 2007',
      descriptionSo: 'Dejiso server-ka kaydka — param 2006 / 2007',
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
      supportedModels: _all,
    ),

    CommandModel(
      id: 'net_set_protocol',
      name: 'Set Protocol',
      nameSo: 'Dejiso Borotokoolka',
      description: 'Switch between TCP and UDP — param ID 2009',
      descriptionSo: 'Rog dhexda TCP iyo UDP — param 2009',
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
      supportedModels: _all,
    ),

    CommandModel(
      id: 'net_roaming',
      name: 'Roaming Settings',
      nameSo: 'Dejinta Roaming',
      description: 'Enable or disable data roaming — param ID 2000',
      descriptionSo: 'Fur ama xidh xogta roaming — param 2000',
      category: CommandCategory.network,
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
      supportedModels: _all,
    ),

    CommandModel(
      id: 'net_flush',
      name: 'Flush to Server',
      nameSo: 'Dir Server-ka Kale',
      description: 'Redirect device to another server immediately',
      descriptionSo: 'Si degdeg ah u dir qalabka server-ka kale',
      category: CommandCategory.network,
      template: 'flush {imei},{apn},{login},{pass},{ip},{port},{mode}',
      fields: [
        CommandField(
          key: 'imei',
          label: 'IMEI',
          labelSo: 'IMEI',
          type: FieldType.number,
          hint: '15-digit device IMEI',
          hintSo: 'IMEI-ka 15 lambar ee qalabka',
          required: true,
        ),
        CommandField(
          key: 'apn',
          label: 'APN',
          labelSo: 'APN',
          type: FieldType.text,
          hint: 'e.g. internet',
          hintSo: 'tusaale: internet',
          required: true,
        ),
        CommandField(
          key: 'login',
          label: 'APN Login',
          labelSo: 'Magaca Galidda APN',
          type: FieldType.text,
          hint: 'Leave blank if none',
          hintSo: 'Ka tag maran hadaan jirin',
          required: false,
          defaultValue: '',
        ),
        CommandField(
          key: 'pass',
          label: 'APN Password',
          labelSo: 'Furaha APN',
          type: FieldType.text,
          hint: 'Leave blank if none',
          hintSo: 'Ka tag maran hadaan jirin',
          required: false,
          defaultValue: '',
        ),
        CommandField(
          key: 'ip',
          label: 'Server IP',
          labelSo: 'IP-ga Server-ka',
          type: FieldType.text,
          hint: 'e.g. 192.168.1.100',
          hintSo: 'tusaale: 192.168.1.100',
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
        CommandField(
          key: 'mode',
          label: 'Mode',
          labelSo: 'Habka',
          type: FieldType.dropdown,
          options: ['0', '1'],
          hint: '0=TCP, 1=UDP',
          hintSo: '0=TCP, 1=UDP',
          required: true,
          defaultValue: '0',
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'net_get_params',
      name: 'Get Network Params',
      nameSo: 'Hel Xogta Shabakadda',
      description: 'Get current APN, server and protocol configuration',
      descriptionSo: 'Hel habaynta hadda jirta ee APN, server iyo borotokoolka',
      category: CommandCategory.network,
      template: 'getparam 2000 2001 2004 2005 2006',
      supportedModels: _all,
    ),

    // ══════════════════════════════════════════════════════════════
    // TRACKING
    // ══════════════════════════════════════════════════════════════

    CommandModel(
      id: 'track_get_gps',
      name: 'Get GPS Location',
      nameSo: 'Hel Goobta GPS',
      description: 'Returns location with Google Maps link',
      descriptionSo: 'Soo celi goobta iyo xiriirka Google Maps',
      category: CommandCategory.tracking,
      template: 'ggps',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'track_min_period',
      name: 'Set Min Period',
      nameSo: 'Dejiso Xilliga Ugu Yar',
      description: 'Minimum record saving period in seconds — param 10001',
      descriptionSo: 'Xilliga kaydinta diiwaanka ugu yar ilbiriqsiyo — param 10001',
      category: CommandCategory.tracking,
      template: 'setparam 10001:{seconds}',
      fields: [
        CommandField(
          key: 'seconds',
          label: 'Interval (seconds)',
          labelSo: 'Xilliga (ilbiriqsiyo)',
          type: FieldType.number,
          hint: 'e.g. 30',
          hintSo: 'tusaale: 30',
          required: true,
          suffix: 'sec',
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'track_send_period',
      name: 'Set Send Period',
      nameSo: 'Dejiso Xilliga Dirista',
      description: 'How often device sends data to server in seconds — param 10002',
      descriptionSo: 'Intee jeer qalabku xogta server-ka u diro — param 10002',
      category: CommandCategory.tracking,
      template: 'setparam 10002:{seconds}',
      fields: [
        CommandField(
          key: 'seconds',
          label: 'Send Period (seconds)',
          labelSo: 'Xilliga Dirista (ilbiriqsiyo)',
          type: FieldType.number,
          hint: 'e.g. 60',
          hintSo: 'tusaale: 60',
          required: true,
          suffix: 'sec',
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'track_on_move',
      name: 'Moving / Stopped Intervals',
      nameSo: 'Xilliyadda Socotada / Joogitaanka',
      description: 'Set different record intervals for moving vs stopped — param 10001 / 10003',
      descriptionSo: 'Dejiso xilliyadda kala duwan ee socotada iyo joogitaanka — param 10001 / 10003',
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
      supportedModels: _all,
    ),

    CommandModel(
      id: 'track_ignition_source',
      name: 'Ignition Source',
      nameSo: 'Isha Ignition',
      description: 'Set ignition detection source — param 10200',
      descriptionSo: 'Dejiso isha ogaanshaha ignition — param 10200',
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
          hintSo: '0=Ignition, 1=Din1, 2=Dhaqdhaqaaqa, 3=Korantada, 5=CAN',
          required: true,
          defaultValue: '0',
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'track_sleep_mode',
      name: 'Sleep Mode',
      nameSo: 'Habka Hurda',
      description: 'Configure device sleep mode to save power — param 10050',
      descriptionSo: 'Habeyn habka hurda qalabka si aad tamar uga badbaadiso — param 10050',
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
          hintSo: '0=Xiran, 1=GPS Hurdada, 2=Hurdo Qoto Dheer, 3=Hurdo Online',
          required: true,
          defaultValue: '0',
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'track_odoget',
      name: 'Get Odometer',
      nameSo: 'Hel Odometer-ka',
      description: 'Display current odometer value',
      descriptionSo: 'Muuji qiimaha odometer-ka hadda',
      category: CommandCategory.tracking,
      template: 'odoget',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'track_odoset',
      name: 'Set Odometer',
      nameSo: 'Dejiso Odometer-ka',
      description: 'Set total odometer value in km',
      descriptionSo: 'Dejiso qiimaha odometer-ka guud ee kiilomitirka',
      category: CommandCategory.tracking,
      template: 'odoset:{km}',
      fields: [
        CommandField(
          key: 'km',
          label: 'Odometer Value (km)',
          labelSo: 'Qiimaha Odometer (km)',
          type: FieldType.number,
          hint: 'e.g. 150000',
          hintSo: 'tusaale: 150000',
          required: true,
          suffix: 'km',
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'track_fc_reset',
      name: 'Reset Fuel Consumption',
      nameSo: 'Dib u Habeyn Shidaalka',
      description: 'Resets fuel consumption parameters',
      descriptionSo: 'Dib u habeyn xuduudaha isticmaalka shidaalka',
      category: CommandCategory.tracking,
      template: 'fc_reset',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'track_towing',
      name: 'Towing Reactivation',
      nameSo: 'Dib u Shidid Jiidista',
      description: 'Reactivate towing detection after a towing event',
      descriptionSo: 'Dib u shid ogaanshaha jiidista ka dib xaaladda jiidista',
      category: CommandCategory.tracking,
      template: 'towingreact',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'track_calibrate',
      name: 'Auto Calibrate Status',
      nameSo: 'Xaaladda Habeynta Otomaatigga',
      description: 'Returns the state of auto-calibration',
      descriptionSo: 'Soo celi xaaladda habeynta otomaatigga',
      category: CommandCategory.tracking,
      template: 'auto_calibrate:get',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'track_on_demand',
      name: 'On-Demand Tracking',
      nameSo: 'Raadraac Dalbashada',
      description: 'Start, stop or trigger one record of on-demand tracking',
      descriptionSo: 'Bilow, joogsi ama fur hal diiwaanka raadraaca dalbashada',
      category: CommandCategory.tracking,
      template: 'on_demand_tracking{mode}',
      fields: [
        CommandField(
          key: 'mode',
          label: 'Mode',
          labelSo: 'Habka',
          type: FieldType.dropdown,
          options: ['0', '1', '2'],
          hint: '0=Stop, 1=Start, 2=One high-priority record',
          hintSo: '0=Joogso, 1=Bilow, 2=Hal diiwaanka muhiimka ah',
          required: true,
          defaultValue: '1',
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'track_go2sleep',
      name: 'Force Sleep',
      nameSo: 'Ku Qasab Hurdada',
      description: 'Put device to sleep ignoring normal sleep conditions',
      descriptionSo: 'Qalabka u geli hurdada adiga oo iska indhatiraya xaaladaha caadiga ah',
      category: CommandCategory.tracking,
      template: 'go2sleep',
      supportedModels: _all,
      isDangerous: true,
      dangerMessage: 'Device will sleep and go offline. It will stay asleep for the configured sleep duration.',
    ),

    // ══════════════════════════════════════════════════════════════
    // OUTPUTS
    // ══════════════════════════════════════════════════════════════

    CommandModel(
      id: 'out_setdigout',
      name: 'Set Digital Output',
      nameSo: 'Dejiso Saarista Tirakoobka',
      description: 'Set DOUT1 and DOUT2 states with optional timeouts',
      descriptionSo: 'Dejiso xaaladda DOUT1 iyo DOUT2 iyo muddada ikhtiyaariga ah',
      category: CommandCategory.outputs,
      template: 'setdigout {d1}{d2} {t1} {t2}',
      fields: [
        CommandField(
          key: 'd1',
          label: 'DOUT1 State',
          labelSo: 'Xaaladda DOUT1',
          type: FieldType.dropdown,
          options: ['0', '1', '?'],
          hint: '0=OFF, 1=ON, ?=Ignore',
          hintSo: '0=DEMIS, 1=SHID, ?=Iska daa',
          required: true,
          defaultValue: '1',
        ),
        CommandField(
          key: 'd2',
          label: 'DOUT2 State',
          labelSo: 'Xaaladda DOUT2',
          type: FieldType.dropdown,
          options: ['0', '1', '?'],
          hint: '0=OFF, 1=ON, ?=Ignore',
          hintSo: '0=DEMIS, 1=SHID, ?=Iska daa',
          required: true,
          defaultValue: '?',
        ),
        CommandField(
          key: 't1',
          label: 'DOUT1 Timeout (sec)',
          labelSo: 'Muddada DOUT1 (ilbiriqsi)',
          type: FieldType.number,
          hint: 'Timeout in seconds (0 = none)',
          hintSo: 'Muddada ilbiriqsiyo (0 = ma jirto)',
          required: false,
          defaultValue: '0',
          suffix: 'sec',
        ),
        CommandField(
          key: 't2',
          label: 'DOUT2 Timeout (sec)',
          labelSo: 'Muddada DOUT2 (ilbiriqsi)',
          type: FieldType.number,
          hint: 'Timeout in seconds (0 = none)',
          hintSo: 'Muddada ilbiriqsiyo (0 = ma jirto)',
          required: false,
          defaultValue: '0',
          suffix: 'sec',
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'out_engine_cut',
      name: 'Engine Cut (DOUT1 ON)',
      nameSo: 'Jari Matoorka (DOUT1 SHID)',
      description: 'Remotely cut the engine via DOUT1',
      descriptionSo: 'Fog u jar matoorka adiga oo isticmaalaya DOUT1',
      category: CommandCategory.outputs,
      template: 'setdigout 1?',
      supportedModels: _all,
      isDangerous: true,
      dangerMessage: 'This will cut the engine remotely. Only use when vehicle is stationary.',
    ),

    CommandModel(
      id: 'out_engine_restore',
      name: 'Engine Restore (DOUT1 OFF)',
      nameSo: 'Soo Celiso Matoorka (DOUT1 DEMIS)',
      description: 'Restore engine by turning DOUT1 off',
      descriptionSo: 'Soo celiso matoorka adiga oo damisaya DOUT1',
      category: CommandCategory.outputs,
      template: 'setdigout 0?',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'out_cleardigoutprio',
      name: 'Clear DOUT Priority',
      nameSo: 'Nadiifi Mudnaanta DOUT',
      description: 'Clears setdigout priority for specified DOUTs',
      descriptionSo: 'Nadiifi mudnaanta setdigout ee DOUT-yada la cayimay',
      category: CommandCategory.outputs,
      template: 'cleardigoutprio {d1}{d2}',
      fields: [
        CommandField(
          key: 'd1',
          label: 'DOUT1',
          labelSo: 'DOUT1',
          type: FieldType.dropdown,
          options: ['0', '1'],
          hint: '0=Ignore, 1=Clear priority',
          hintSo: '0=Iska daa, 1=Nadiifi mudnaanta',
          required: true,
          defaultValue: '1',
        ),
        CommandField(
          key: 'd2',
          label: 'DOUT2',
          labelSo: 'DOUT2',
          type: FieldType.dropdown,
          options: ['0', '1'],
          hint: '0=Ignore, 1=Clear priority',
          hintSo: '0=Iska daa, 1=Nadiifi mudnaanta',
          required: true,
          defaultValue: '0',
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'out_setigndigout',
      name: 'Set DOUT on Ignition Off',
      nameSo: 'Dejiso DOUT markii Ignition Damto',
      description: 'Set digital output states when ignition is off',
      descriptionSo: 'Dejiso xaaladaha saarista tirakoobka marka ignition-ku demisto',
      category: CommandCategory.outputs,
      template: 'setigndigout {d1}{d2} {t1} {t2}',
      fields: [
        CommandField(
          key: 'd1',
          label: 'DOUT1 State',
          labelSo: 'Xaaladda DOUT1',
          type: FieldType.dropdown,
          options: ['0', '1', '?'],
          hint: '0=OFF, 1=ON, ?=Ignore',
          hintSo: '0=DEMIS, 1=SHID, ?=Iska daa',
          required: true,
          defaultValue: '0',
        ),
        CommandField(
          key: 'd2',
          label: 'DOUT2 State',
          labelSo: 'Xaaladda DOUT2',
          type: FieldType.dropdown,
          options: ['0', '1', '?'],
          hint: '0=OFF, 1=ON, ?=Ignore',
          hintSo: '0=DEMIS, 1=SHID, ?=Iska daa',
          required: true,
          defaultValue: '?',
        ),
        CommandField(
          key: 't1',
          label: 'DOUT1 Timeout (sec)',
          labelSo: 'Muddada DOUT1 (ilbiriqsi)',
          type: FieldType.number,
          hint: '0 = no timeout',
          hintSo: '0 = muddad la\'aanta',
          required: false,
          defaultValue: '0',
          suffix: 'sec',
        ),
        CommandField(
          key: 't2',
          label: 'DOUT2 Timeout (sec)',
          labelSo: 'Muddada DOUT2 (ilbiriqsi)',
          type: FieldType.number,
          hint: '0 = no timeout',
          hintSo: '0 = muddad la\'aanta',
          required: false,
          defaultValue: '0',
          suffix: 'sec',
        ),
      ],
      supportedModels: _all,
    ),

    // ══════════════════════════════════════════════════════════════
    // BLUETOOTH
    // ══════════════════════════════════════════════════════════════

    CommandModel(
      id: 'bt_scan',
      name: 'BT Scan',
      nameSo: 'Raadi Bluetooth',
      description: 'Start Bluetooth scan for nearby devices',
      descriptionSo: 'Bilow raadinta Bluetooth ee qalabka dhow',
      category: CommandCategory.bluetooth,
      template: 'btscan',
      supportedModels: _btModels,
    ),

    CommandModel(
      id: 'bt_getlist',
      name: 'BT Get List',
      nameSo: 'Hel Liiska Bluetooth',
      description: 'Returns a Bluetooth device list by type',
      descriptionSo: 'Soo celi liiska qalabka Bluetooth nooca la doortay',
      category: CommandCategory.bluetooth,
      template: 'btgetlist {type}',
      fields: [
        CommandField(
          key: 'type',
          label: 'List Type',
          labelSo: 'Nooca Liiska',
          type: FieldType.dropdown,
          options: ['0', '1', '2', '3'],
          hint: '0=Discovered, 1=Paired, 2=Connected, 3=BLE devices',
          hintSo: '0=La Ogaaday, 1=La Kujowsaday, 2=Xiddan, 3=Qalabka BLE',
          required: true,
          defaultValue: '1',
        ),
      ],
      supportedModels: _btModels,
    ),

    CommandModel(
      id: 'bt_visible',
      name: 'BT Visible',
      nameSo: 'BT La Arki Karo',
      description: 'Set Bluetooth visible with a timeout in seconds',
      descriptionSo: 'Dejiso Bluetooth si la arki karo oo leh muddad ilbiriqsiyo',
      category: CommandCategory.bluetooth,
      template: 'btvisible {tmo}',
      fields: [
        CommandField(
          key: 'tmo',
          label: 'Visibility Timeout (sec)',
          labelSo: 'Muddada Arkaanshaha (ilbiriqsi)',
          type: FieldType.number,
          hint: '1–255 seconds',
          hintSo: '1–255 ilbiriqsi',
          required: true,
          defaultValue: '60',
          suffix: 'sec',
        ),
      ],
      supportedModels: _btModels,
    ),

    CommandModel(
      id: 'bt_release',
      name: 'BT Release',
      nameSo: 'Xidh Xiriirka BT',
      description: 'Disconnect from current BT device and pause auto-connect',
      descriptionSo: 'Ka faridh qalabka BT hadda xiddan oo jooji xidashada otomaatigga',
      category: CommandCategory.bluetooth,
      template: 'btrelease {tmo}',
      fields: [
        CommandField(
          key: 'tmo',
          label: 'Pause Timeout (sec)',
          labelSo: 'Muddada Joojinta (ilbiriqsi)',
          type: FieldType.number,
          hint: '1–255 seconds (0 = no pause)',
          hintSo: '1–255 ilbiriqsi (0 = jooji la\'aan)',
          required: false,
          defaultValue: '0',
          suffix: 'sec',
        ),
      ],
      supportedModels: _btModels,
    ),

    CommandModel(
      id: 'bt_unpair',
      name: 'BT Unpair',
      nameSo: 'Ka Faridh BT',
      description: 'Unpair a Bluetooth device by MAC address or unpair all',
      descriptionSo: 'Ka faridh qalabka Bluetooth adiga oo isticmaalaya MAC ama ka faridh dhammaan',
      category: CommandCategory.bluetooth,
      template: 'btunpair {target}',
      fields: [
        CommandField(
          key: 'target',
          label: 'Target',
          labelSo: 'Hadafka',
          type: FieldType.text,
          hint: '"all" or BT MAC address (AA:BB:CC:DD:EE:FF)',
          hintSo: '"all" ama cinwaanka MAC (AA:BB:CC:DD:EE:FF)',
          required: true,
          defaultValue: 'all',
        ),
      ],
      supportedModels: _btModels,
    ),

    CommandModel(
      id: 'ble_enable',
      name: 'Enable Bluetooth',
      nameSo: 'Fur Bluetooth',
      description: 'Enable Bluetooth module — param 11000:1',
      descriptionSo: 'Fur moduulka Bluetooth — param 11000:1',
      category: CommandCategory.bluetooth,
      template: 'setparam 11000:1',
      supportedModels: _btModels,
    ),

    CommandModel(
      id: 'ble_disable',
      name: 'Disable Bluetooth',
      nameSo: 'Xidh Bluetooth',
      description: 'Disable Bluetooth module — param 11000:0',
      descriptionSo: 'Xidh moduulka Bluetooth — param 11000:0',
      category: CommandCategory.bluetooth,
      template: 'setparam 11000:0',
      supportedModels: _btModels,
    ),

    CommandModel(
      id: 'ble_pair',
      name: 'Pair BLE Sensor',
      nameSo: 'Kujowso Sensor BLE',
      description: 'Pair a Bluetooth sensor by MAC address — param 11002.1',
      descriptionSo: 'Kujow sensor Bluetooth adiga oo isticmaalaya MAC — param 11002.1',
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
      supportedModels: _btModels,
    ),

    // ══════════════════════════════════════════════════════════════
    // OBD
    // ══════════════════════════════════════════════════════════════

    CommandModel(
      id: 'obd_info',
      name: 'OBD Info',
      nameSo: 'Macluumaadka OBD',
      description: 'Display all available OBD information from vehicle',
      descriptionSo: 'Muuji dhammaan macluumaadka OBD ee la heli karo ee baabuurka',
      category: CommandCategory.obd,
      template: 'obdinfo',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'obd_faultcodes',
      name: 'Read Fault Codes',
      nameSo: 'Akhri Koodarka Khaladaadka',
      description: 'Display all visible vehicle DTC fault codes',
      descriptionSo: 'Muuji dhammaan koodarka khaladaadka DTC ee baabuurka la arki karo',
      category: CommandCategory.obd,
      template: 'faultcodes',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'obd_getvin',
      name: 'Get VIN',
      nameSo: 'Hel VIN',
      description: 'Get vehicle VIN identification code',
      descriptionSo: 'Hel koodka aqoonsiga VIN ee baabuurka',
      category: CommandCategory.obd,
      template: 'getvin',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'obd_cleardtc',
      name: 'Clear DTC Codes',
      nameSo: 'Nadiifi Koodarka DTC',
      description: 'Clear all vehicle stored DTC fault codes',
      descriptionSo: 'Nadiifi dhammaan koodarka khaladaadka DTC ee kaydsan ee baabuurka',
      category: CommandCategory.obd,
      template: 'cleardtc',
      supportedModels: _all,
      isDangerous: true,
      dangerMessage: 'This will clear all stored vehicle fault codes. Make sure to document them first.',
    ),

    // ══════════════════════════════════════════════════════════════
    // CAN ADAPTER
    // ══════════════════════════════════════════════════════════════

    CommandModel(
      id: 'can_getinfo',
      name: 'CAN Adapter Info',
      nameSo: 'Macluumaadka CAN Adapter',
      description: 'Get information about the connected CAN adapter',
      descriptionSo: 'Hel macluumaadka CAN adapter-ka xiddan',
      category: CommandCategory.can,
      template: 'lvcangetinfo',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_getprog',
      name: 'Get CAN Program',
      nameSo: 'Hel Barnaamijka CAN',
      description: 'Get program number from CAN adapter',
      descriptionSo: 'Hel lambarka barnaamijka ee CAN adapter-ka',
      category: CommandCategory.can,
      template: 'lvcangetprog',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_setprog',
      name: 'Set CAN Program',
      nameSo: 'Dejiso Barnaamijka CAN',
      description: 'Set vehicle-specific program number on CAN adapter (3–5 digits)',
      descriptionSo: 'Dejiso lambarka barnaamijka gaar u ah baabuurka CAN adapter-ka (3-5 lambar)',
      category: CommandCategory.can,
      template: 'lvcansetprog {prog}',
      fields: [
        CommandField(
          key: 'prog',
          label: 'Program Number',
          labelSo: 'Lambarka Barnaamijka',
          type: FieldType.number,
          hint: '3–5 digit vehicle-specific number',
          hintSo: 'Lambarka 3-5 gaar u ah baabuurka',
          required: true,
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_faultcodes',
      name: 'CAN Fault Codes',
      nameSo: 'Koodarka Khaladaadka CAN',
      description: 'Read DTC fault codes from CAN adapter',
      descriptionSo: 'Akhri koodarka khaladaadka DTC ee CAN adapter-ka',
      category: CommandCategory.can,
      template: 'lvcanfaultcodes',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_check',
      name: 'CAN Lines Check',
      nameSo: 'Hubi Xariirada CAN',
      description: 'Report CAN lines connection information',
      descriptionSo: 'Warbixin macluumaadka xiriirka xariirada CAN',
      category: CommandCategory.can,
      template: 'lvcancheck',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_open_doors',
      name: 'Open All Doors',
      nameSo: 'Fur Dhammaan Albaabada',
      description: 'CAN-CONTROL — unlock all vehicle doors',
      descriptionSo: 'CAN-CONTROL — xidh qufulka dhammaan albaabada baabuurka',
      category: CommandCategory.can,
      template: 'lvcanopenalldoors',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_close_doors',
      name: 'Close All Doors',
      nameSo: 'Xidh Dhammaan Albaabada',
      description: 'CAN-CONTROL — lock all vehicle doors',
      descriptionSo: 'CAN-CONTROL — xidh dhammaan albaabada baabuurka',
      category: CommandCategory.can,
      template: 'lvcanclosealldoors',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_open_trunk',
      name: 'Open Trunk',
      nameSo: 'Fur Sanduuqa Gadaasha',
      description: 'CAN-CONTROL — unlock vehicle trunk',
      descriptionSo: 'CAN-CONTROL — xidh qufulka sanduuqa gadaasha baabuurka',
      category: CommandCategory.can,
      template: 'lvcanopentrunk',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_lights',
      name: 'Flash Lights',
      nameSo: 'Baraar Nalayaasha',
      description: 'CAN-CONTROL — flash turn/indicator lights once',
      descriptionSo: 'CAN-CONTROL — baraar nalayaasha tilmaanta hal mar',
      category: CommandCategory.can,
      template: 'lvcanturninglights',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_horn',
      name: 'Activate Horn',
      nameSo: 'Shid Garaacaha',
      description: 'CAN-CONTROL — activate a single horn sound',
      descriptionSo: 'CAN-CONTROL — shid sawt garaaca hal mar',
      category: CommandCategory.can,
      template: 'lvcanhorn',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_block_engine',
      name: 'Block Engine',
      nameSo: 'Xidh Matoorka CAN',
      description: 'CAN-CONTROL — remotely block vehicle engine',
      descriptionSo: 'CAN-CONTROL — fog u xidh matoorka baabuurka',
      category: CommandCategory.can,
      template: 'lvcanblockengine',
      supportedModels: _all,
      isDangerous: true,
      dangerMessage: 'This will remotely block the engine via CAN. Only use when vehicle is stopped.',
    ),

    CommandModel(
      id: 'can_unblock_engine',
      name: 'Unblock Engine',
      nameSo: 'Fur Xididdada Matoorka CAN',
      description: 'CAN-CONTROL — remotely unblock vehicle engine',
      descriptionSo: 'CAN-CONTROL — fog u fur matoorka baabuurka',
      category: CommandCategory.can,
      template: 'lvcanunblockengine',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_simpletacho',
      name: 'Simple Tacho Byte',
      nameSo: 'Bayitka Tacho-ka Fudud',
      description: 'Add or remove simpletacho start byte from CAN adapter',
      descriptionSo: 'Ku dar ama ka saar bayitka bilaabista simpletacho ee CAN adapter-ka',
      category: CommandCategory.can,
      template: 'lvcansimpletacho {mode}',
      fields: [
        CommandField(
          key: 'mode',
          label: 'Mode',
          labelSo: 'Habka',
          type: FieldType.dropdown,
          options: ['0', '1'],
          hint: '0=Don\'t add start byte, 1=Add start byte',
          hintSo: '0=Ha ku darin, 1=Ku dar bayitka bilaabista',
          required: true,
          defaultValue: '1',
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_setting',
      name: 'CAN Set Counter',
      nameSo: 'Dejiso Tiriyaha CAN',
      description: 'Set specific vehicle counters (mileage, engine time, fuel, etc.)',
      descriptionSo: 'Dejiso tiriyayaasha gaarka ah ee baabuurka (masaafada, waqtiga matoorka, shidaalka)',
      category: CommandCategory.can,
      template: 'lvcansetting:{counter},{value}',
      fields: [
        CommandField(
          key: 'counter',
          label: 'Counter Type',
          labelSo: 'Nooca Tiriyaha',
          type: FieldType.dropdown,
          options: ['0', '1', '2', '3', '4', '5'],
          hint: '0=Engine time(s), 1=Mileage(km), 2=Fuel(L), 3=CNG(kg), 4=Elec time(s), 5=Wheel impulses',
          hintSo: '0=Waqtiga matoorka, 1=Masaafada(km), 2=Shidaalka(L), 3=CNG(kg)',
          required: true,
          defaultValue: '1',
        ),
        CommandField(
          key: 'value',
          label: 'Value (or ? to read)',
          labelSo: 'Qiimaha (ama ? si aad u akhrisid)',
          type: FieldType.text,
          hint: 'Numeric value or ? to get current',
          hintSo: 'Qiimaha tirakoobka ama ? si aad u aragto hadda',
          required: true,
          defaultValue: '?',
        ),
      ],
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_refresh',
      name: 'CAN Refresh',
      nameSo: 'Cusbooneysii CAN',
      description: 'Force connection to FOTA WEB to report CAN adapter status',
      descriptionSo: 'Ku qasab xiriirka FOTA WEB si loo warbixiyo xaaladda CAN adapter',
      category: CommandCategory.can,
      template: 'lvcanrefresh',
      supportedModels: _all,
    ),

    CommandModel(
      id: 'can_reset',
      name: 'CAN Reset',
      nameSo: 'Dib u Bilow CAN',
      description: 'Force CAN adapter reset',
      descriptionSo: 'Ku qasab dib u bilaabista CAN adapter-ka',
      category: CommandCategory.can,
      template: 'lvcanreset',
      supportedModels: _all,
      isDangerous: true,
      dangerMessage: 'This will reset the CAN adapter. CAN data will be unavailable during restart.',
    ),

    CommandModel(
      id: 'can_dtcclear',
      name: 'CAN Clear DTC',
      nameSo: 'Nadiifi DTC CAN',
      description: 'Clear all DTC fault codes from CAN adapter',
      descriptionSo: 'Nadiifi dhammaan koodarka khaladaadka DTC ee CAN adapter-ka',
      category: CommandCategory.can,
      template: 'lvcandtcclear',
      supportedModels: _all,
      isDangerous: true,
      dangerMessage: 'All CAN DTC fault codes will be permanently cleared.',
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

// ─── Server Presets ───────────────────────────────────────────────────────────
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
