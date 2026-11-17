/**
 * More words of Hebrew and Aramaic origin, in YIVO spelling with their YIVO
 * romanisation (plan W7.9), read both ways by text/yiddish.ts after its own
 * short table. Lumen's own selection (MIT), from common Yiddish usage:
 * religious life, family, community, learning and everyday speech.
 *
 * Left out on purpose: forms whose romanisation is also a common non-Hebrew
 * word (צער "tsar" is also צאַר, the czar), so Latin text never turns a loan
 * into a Hebraism. `yiddishHebraisms.test.ts` checks that every entry comes
 * back both ways and that no romanisation is shared.
 */
export const HEBRAISMS_MORE: ReadonlyArray<readonly [yiddish: string, latin: string]> = [
  // Religious life
  ["שבתים", "shabosim"], ["מצוות", "mitsves"], ["ברכה", "brokhe"], ["ברכות", "brokhes"], ["קידוש", "kidesh"],
  ["הבֿדלה", "havdole"], ["סעודה", "seude"], ["שׂימחות", "simkhes"], ["כּשר", "kosher"], ["כּשרות", "kashres"],
  ["מזוזה", "mezuze"], ["תּפֿילין", "tfilin"], ["טלית", "tales"], ["רבֿ", "rov"], ["רבנים", "rabonim"],
  ["גבאי", "gabe"], ["שמש", "shames"], ["חזן", "khazn"], ["חזנים", "khazonim"], ["מקווה", "mikve"],
  ["מנין", "minyen"], ["מנהג", "minheg"], ["הלכה", "halokhe"], ["תּשובֿה", "tshuve"], ["תּענית", "tones"],
  ["עבֿירה", "aveyre"], ["ערבֿ", "erev"], ["חומש", "khumesh"], ["תּלמוד", "talmed"], ["גמרא", "gemore"],
  ["משנה", "mishne"], ["מדרש", "medresh"], ["פּירוש", "perush"], ["מלאך", "malekh"], ["מלאכים", "malokhim"],
  ["נביא", "novi"], ["נס", "nes"], ["נסים", "nisim"], ["גאולה", "geule"], ["משיח", "meshiekh"],
  // Family and community
  ["בחור", "bokher"], ["בחורים", "bokherim"], ["שכן", "shokhn"], ["שכנים", "shkheynim"], ["אורח", "oyrekh"],
  ["אורחים", "orkhim"], ["יתום", "yosem"], ["יתומים", "yesoymim"], ["אַלמנה", "almone"], ["מחותּן", "mekhutn"],
  ["מחותּנים", "mekhutonim"], ["שדכן", "shadkhn"], ["שידוך", "shidekh"], ["תּנאָים", "tnoim"], ["ייִחוס", "yikhes"],
  ["בעל־הבית", "balebos"], ["בעלי־בתּים", "balebatim"], ["בעל־עגלה", "balegole"], ["חבֿרה", "khevre"], ["קהל", "kool"],
  ["קרובֿ", "korev"], ["קרובֿים", "kroyvim"], ["גנבֿ", "ganef"], ["גנבֿים", "ganovim"], ["גזלן", "gazlen"],
  ["שׂונא", "soyne"], ["שׂונאים", "sonim"], ["סוחר", "soykher"], ["מלמדים", "melamdim"], ["נדבֿה", "nedove"],
  ["צדקה", "tsdoke"], ["פּרנסה", "parnose"], ["מסחר", "miskher"], ["משׂכּורת", "maskoyres"], ["ירושה", "yerushe"],
  // Learning and the mind
  ["ספֿרות", "sifrus"], ["השׂכּלה", "haskole"], ["לשון", "loshn"], ["לשון־קודש", "loshn-koydesh"], ["מבֿין", "meyvn"],
  ["חידוש", "khidesh"], ["חילוק", "khilek"], ["וויכּוח", "vikuekh"], ["שאלה", "shayle"], ["שיעור", "shier"],
  ["משל", "moshl"], ["סוד", "sod"], ["סודות", "soydes"], ["סיבה", "sibe"], ["עיקר", "iker"],
  ["עניין", "inyen"], ["כּלל", "klal"], ["פּשוט", "poshet"], ["מוח", "moyekh"], ["מוסר", "muser"],
  // Everyday speech
  ["ים", "yam"], ["ימען", "yamen"], ["כּוח", "koyekh"], ["כּוחות", "koykhes"], ["מורא", "moyre"],
  ["נחת", "nakhes"], ["חן", "kheyn"], ["חלק", "kheylek"], ["חסרון", "khisorn"], ["חרפּה", "kharpe"],
  ["חשד", "khshad"], ["טובֿה", "toyve"], ["טעות", "toes"], ["טעם", "tam"], ["טרחה", "tirkhe"],
  ["כּעס", "kas"], ["מאכל", "maykhl"], ["מחלוקת", "makhloykes"], ["מיתה", "mise"], ["מלאָכה", "melokhe"],
  ["מלבוש", "malbesh"], ["ממשלה", "memshole"], ["מעלה", "mayle"], ["מעשׂים", "maysim"], ["מקום", "mokem"],
  ["משוגע", "meshuge"], ["משפּט", "mishpet"], ["נסיון", "nisoyen"], ["סגולה", "sgule"], ["סכּנה", "sakone"],
  ["עדות", "eydes"], ["קבֿר", "keyver"], ["קבֿרים", "kvorim"], ["קנאה", "kine"], ["רחמים", "rakhmim"],
  ["רשעות", "rishes"], ["שמועה", "shmue"], ["שקר", "sheker"], ["תּקנה", "takone"], ["זכות", "zkhus"],
  ["זמן", "zman"], ["חודש", "khoydesh"], ["חוץ", "khuts"], ["חזיר", "khazer"], ["יום", "yom"],
  ["גוף", "guf"], ["גורל", "goyrl"], ["דור", "dor"], ["דורות", "doyres"], ["דרך", "derekh"],
  ["דין", "din"], ["גאווה", "gayve"], ["גבֿורה", "gvure"], ["השגחה", "hashgokhe"], ["התחלה", "haskhole"],
  ["שלימזל", "shlimazl"], ["אַדרבה", "adrabe"], ["כּלומרשט", "klomersht"], ["לבֿנה", "levone"], ["שנה", "shone"],
];
