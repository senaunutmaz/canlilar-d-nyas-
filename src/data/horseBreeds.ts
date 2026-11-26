import { HorseBreedRecord } from '../types/biodiversity';
import { verifyImageAssetUrlsBatch, isTransientMediaVerifyFailure } from '../services/gbif';

/**
 * Doğrulanmış açık erişim kaynaklarına (Wikipedia / ırk kayıtları) dayalı Equus caballus at ırkları kataloğu.
 * Önemli bilimsel ilke: At ırkları ayrı biyolojik türler değildir; tamamı Equus caballus türüne aittir.
 * İngiliz Atı ve Thoroughbred aynı ırk olduğu için tek kayıtta ("İngiliz Atı (Thoroughbred)") birleştirilmiştir.
 * Irk düzeyinde uydurma GBIF gözlem sayısı veya kesin olmayan popülasyon rakamları üretilmez.
 */
export const HORSE_BREEDS_CATALOG: HorseBreedRecord[] = [
  {
    slug: 'arap-ati',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil At Irkı)',
    turkishName: 'Arap Atı',
    internationalName: 'Arabian Horse',
    aliases: ['arap atı', 'arap ati', 'arabian', 'arabian horse', 'arab horse'],
    category: 'riding_racing',
    categoryLabel: 'Binek, Dayanıklılık & Yarış Atı',
    originCountryOrRegion: 'Arap Yarımadası (Batı Asya)',
    distinguishingTraits: [
      'İçbükey (çukur) burun profili, geniş alın ve iri gözlerle kolayca tanınan kafa yapısı',
      'Yüksek tutulan kuyruk ve zarif, kemerli boyun duruşu',
      'Uzun mesafe dayanıklılık (endurance) biniciliğinde yüksek performans',
      'Modern sıcakkanlı ve İngiliz atı (Thoroughbred) dahil pek çok ırkın ıslahında temel soy katkısı',
    ],
    summary:
      'Arap Yarımadası kökenli Arap Atı, yazılı soy kayıtları yüzyıllar öncesine uzanan en eski modern evcil at ırklarından biridir. Sıcak ve kurak iklim koşullarına yüksek dayanıklılığı ve karakteristik kafa profili ile dünya genelinde tanınır.',
    distributionAndPopulationNote:
      'GBIF gözlem arşivi kayıtları tür düzeyinde (Equus caballus) tutulur; Arap Atı için ayrı bir GBIF gözlem veya coğrafi dağılım sayacı bulunmamaktadır. Küresel ölçekte pek çok ülkede tescilli damızlık dernekleri tarafından yetiştirilmekle birlikte standart gerçek zamanlı küresel popülasyon verisi mevcut değildir.',
    wikipediaTitle: 'Arabian horse',
    sourceUrl: 'https://en.wikipedia.org/wiki/Arabian_horse',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'ingiliz-ati-thoroughbred',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil At Irkı)',
    turkishName: 'İngiliz Atı (Thoroughbred)',
    internationalName: 'Thoroughbred',
    aliases: [
      'ingiliz atı',
      'ingiliz ati',
      'safkan ingiliz',
      'safkan ingiliz atı',
      'thoroughbred',
      'english thoroughbred',
    ],
    category: 'riding_racing',
    categoryLabel: 'Binek, Dayanıklılık & Yarış Atı',
    originCountryOrRegion: 'İngiltere (Birleşik Krallık)',
    distinguishingTraits: [
      '17–18. yüzyıllarda İngiltere’de yerel kısraklar ile üç Arap/Türk/Berberi aygır soyunun melezlenmesiyle geliştirilmiş sıcakkanlı yarış ırkı',
      'Yüksek sürat, çeviklik ve ince, uzun kaslı bacak yapısı',
      'Türkiye ve uluslararası yarışçılıkta "İngiliz Atı" ile "Thoroughbred" aynı tescilli ırkı ifade eder',
    ],
    summary:
      'Türkçede yaygın olarak "İngiliz Atı" adıyla bilinen Thoroughbred, başlıca düz koşu yarışları için İngiltere’de geliştirilmiş sıcakkanlı bir at ırkıdır. Aynı ırkın farklı isimlerle tekrarlanmasını önlemek için İngiliz Atı ve Thoroughbred tek kayıt altında sunulmuştur.',
    distributionAndPopulationNote:
      'GBIF kayıtları biyolojik tür olan Equus caballus düzeyinde derlendiğinden, İngiliz Atı (Thoroughbred) ırkına özgü ayrı bir GBIF dağılım veya gözlem sayacı yoktur. Yarışçılık otoriteleri (General Stud Book vb.) kendi soy kütüklerini tutar ancak açık erişimli gerçek zamanlı küresel nüfus sayımı bulunmamaktadır.',
    wikipediaTitle: 'Thoroughbred',
    sourceUrl: 'https://en.wikipedia.org/wiki/Thoroughbred',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'akhal-teke',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil At Irkı)',
    turkishName: 'Akhal-Teke',
    internationalName: 'Akhal-Teke',
    aliases: ['akhal-teke', 'akhal teke', 'ahal teke', 'ahal-teke', 'türkmen atı'],
    category: 'riding_racing',
    categoryLabel: 'Binek, Dayanıklılık & Yarış Atı',
    originCountryOrRegion: 'Türkmenistan (Orta Asya)',
    distinguishingTraits: [
      'Tüy yapısının ışığı yansıtması nedeniyle "Altın Atlar" olarak anılan belirgin metalik parlaklık',
      'İnce ve seyrek yele-kuyruk, ince deri ve atletik, ince uzun gövde yapısı',
      'Sert çöl ve step iklimlerine karşı yüksek dayanıklılık',
    ],
    summary:
      'Türkmenistan’ın Ahal vahası ve Teke boyu ile özdeşleşen Akhal-Teke, Orta Asya’nın en eski binek atı soylarından biridir. Hız, uzun mesafe dayanıklılığı ve karakteristik metalik tüy parlaklığı ile ayırt edilir.',
    distributionAndPopulationNote:
      'GBIF üzerinde ırka özgü ayrı gözlem veya yayılış sayacı bulunmaz (tür kaydı Equus caballus altındadır). Açık kaynaklarda nadir/özel damızlık bir ırk olduğu belirtilse de doğrulanmış güncel küresel birey sayısı kaynaklara göre değişkenlik gösterdiğinden kesin popülasyon sayısı sunulmamaktadır.',
    wikipediaTitle: 'Akhal-Teke',
    sourceUrl: 'https://en.wikipedia.org/wiki/Akhal-Teke',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'frizyen-ati',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil At Irkı)',
    turkishName: 'Frizyen Atı',
    internationalName: 'Friesian Horse',
    aliases: ['frizyen atı', 'frizyen ati', 'frizyen', 'friesian', 'friesian horse'],
    category: 'draft_carriage',
    categoryLabel: 'Koşum, Dresaj & Hafif Çeki Atı',
    originCountryOrRegion: 'Frizya (Kuzey Hollanda)',
    distinguishingTraits: [
      'Neredeyse tamamen parlak siyah (yağız) don rengi ve beyaz leke yokluğu veya çok nadir bulunması',
      'Uzun, dalgalı ve gür yele, kuyruk ile alt bacaklarda belirgin tüy (paça) yapısı',
      'Yüksek diz aksiyonlu gösterişli yürüyüş ve hafif çeki / dresaj uyumu',
    ],
    summary:
      'Hollanda’nın kuzeyindeki Frizya eyaletinden köken alan Frizyen Atı, tarihsel süreçte birkaç kez yok olma tehlikesi atlattıktan sonra koruma ve ıslah programlarıyla günümüze ulaşmış, siyah donu ve gür yelesiyle tanınan bir binek ve koşum ırkıdır.',
    distributionAndPopulationNote:
      'GBIF tür bazlı Equus caballus kayıtları dışında Frizyen Atı için ayrı bir gözlem veya dağılım haritası verisi yoktur. Soy kütüğü KFPS tarafından izlenmektedir; açık erişimli standart gerçek zamanlı küresel popülasyon verisi bulunmamaktadır.',
    wikipediaTitle: 'Friesian horse',
    sourceUrl: 'https://en.wikipedia.org/wiki/Friesian_horse',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'endulus-ati',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil At Irkı)',
    turkishName: 'Endülüs Atı',
    internationalName: 'Andalusian (Pura Raza Española)',
    aliases: ['endülüs atı', 'endulus ati', 'endülüs', 'andalusian', 'andalusian horse', 'pura raza española'],
    category: 'riding_racing',
    categoryLabel: 'Binek, Dayanıklılık & Yarış Atı',
    originCountryOrRegion: 'Endülüs / İber Yarımadası (İspanya)',
    distinguishingTraits: [
      '15. yüzyıldan bu yana ayrı bir ırk olarak tanınan Saf İspanyol Atı (Pura Raza Española - PRE) soyu',
      'Kalın ve kemerli boyun, gür dalgalı yele ve belirgin omuz yapısı',
      'Klasik dresaj ve yüksek okul biniciliğinde çevik ve dengeli hareket kabiliyeti',
    ],
    summary:
      'İspanya’nın Endülüs bölgesinden dünyaya yayılan Endülüs Atı (PRE), İber Yarımadası’ndaki kadim binek atı hatlarından gelir. Tarihi boyunca Avrupa’daki pek çok klasik binicilik ırkının (ör. Lipizzan) oluşumunda rol oynamıştır.',
    distributionAndPopulationNote:
      'GBIF, gözlem kayıtlarını Equus caballus tür düzeyinde saklar; Endülüs Atı için ayrı GBIF gözlem sayısı mevcut değildir. Küresel ölçekte standart bir gerçek zamanlı popülasyon verisi sunulmamaktadır.',
    wikipediaTitle: 'Andalusian horse',
    sourceUrl: 'https://en.wikipedia.org/wiki/Andalusian_horse',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'appaloosa',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil At Irkı)',
    turkishName: 'Appaloosa',
    internationalName: 'Appaloosa',
    aliases: ['appaloosa', 'appaloosa horse'],
    category: 'riding_racing',
    categoryLabel: 'Binek, Dayanıklılık & Yarış Atı',
    originCountryOrRegion: 'Kuzeybatı Amerika Birleşik Devletleri (Palouse Bölgesi)',
    distinguishingTraits: [
      'Leopar kompleksi (Lp) genetiğine bağlı benekli/lekeli post desenleri',
      'Dikey çizgili tırnaklar, göz çevresinde belirgin beyaz sklera ve benekli deri',
      'Nez Perce yerlilerinin seleksiyon geleneğiyle şekillenmiş çok yönlü binek ve çiftlik atı',
    ],
    summary:
      'Adını ABD’nin kuzeybatısındaki Palouse Nehri çevresinden alan Appaloosa, kendine özgü benekli kürk desenleriyle tanınan Amerikan binek atı ırkıdır. Vücut tipi farklı hatlara bağlı olarak çeşitlilik gösterebilir.',
    distributionAndPopulationNote:
      'Appaloosa ayrı bir biyolojik tür olmadığından GBIF gözlem kayıtlarında Equus caballus altında ayrı bir ırk sayacı yer almaz. Güncel ve doğrulanmış küresel popülasyon sayısı açık kaynaklarda tekil olarak raporlanmamaktadır.',
    wikipediaTitle: 'Appaloosa',
    sourceUrl: 'https://en.wikipedia.org/wiki/Appaloosa',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'mustang',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Yabanıllaşmış / Feral At Popülasyonu)',
    turkishName: 'Mustang',
    internationalName: 'Mustang',
    aliases: ['mustang', 'american mustang', 'mustang horse'],
    category: 'pony_feral_nordic',
    categoryLabel: 'Pony, Ada & Yabanıllaşmış Popülasyonlar',
    originCountryOrRegion: 'Batı Amerika Birleşik Devletleri',
    distinguishingTraits: [
      'İspanyol sömürge dönemindeki evcil atlardan türemiş serbest dolaşan (feral / yabanıllaşmış) at popülasyonu',
      'Ayrı bir yabani at türü (Equus ferus przewalskii gibi) değildir; genetik olarak Equus caballus türüne aittir',
      'Sert step ve dağlık arazi koşullarına dayanıklı sağlam toynak ve kompakt yapı',
    ],
    summary:
      'Batı ABD’de serbest dolaşan Mustang’ler halk arasında "vahşi at" olarak anılsa da biyolojik olarak evcil at (Equus caballus) soyundan türemiş yabanıllaşmış (feral) popülasyonlardır. Farklı dönemlerde diğer binek/çiftlik atı hatlarından da gen akışı almışlardır.',
    distributionAndPopulationNote:
      'GBIF kayıtları Mustang’i ayrı bir biyolojik tür olarak değil Equus caballus kapsamında değerlendirir; bu nedenle ırka/popülasyona özel GBIF sayacı üretilmez. ABD kamu arazilerindeki serbest popülasyonlar yerel kurumlarca (BLM) izlenmekle birlikte küresel ölçekte standart tek bir popülasyon verisi bulunmamaktadır.',
    isFeralPopulation: true,
    wikipediaTitle: 'Mustang',
    sourceUrl: 'https://en.wikipedia.org/wiki/Mustang',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'haflinger',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil At Irkı)',
    turkishName: 'Haflinger',
    internationalName: 'Haflinger (Avelignese)',
    aliases: ['haflinger', 'avelignese'],
    category: 'pony_feral_nordic',
    categoryLabel: 'Pony, Ada & Yabanıllaşmış Popülasyonlar',
    originCountryOrRegion: 'Avusturya & Kuzey İtalya (Güney Tirol - Hafling)',
    distinguishingTraits: [
      'Her zaman açık altın-kestane (al) don ve açık krem/keten rengi (flaxen) yele-kuyruk',
      'Küçük-orta boylu ancak kaslı, dağlık arazide dengeli ve güçlü gövde yapısı',
      '19. yüzyıl sonunda Alplerde yük taşıma ve binek amacıyla geliştirilmiş dayanıklı ırk',
    ],
    summary:
      'Adını Güney Tirol’deki Hafling bölgesinden alan Haflinger (İtalyancada Avelignese), yalnızca al don ve açık krem renkli yele-kuyruk kombinasyonuyla tanınan, dağlık arazide uyumlu ve güçlü bir Alp atı ırkıdır.',
    distributionAndPopulationNote:
      'GBIF tarafından ırk düzeyinde ayrı gözlem/yayılış sayacı tutulmamaktadır (tür Equus caballus). Doğrulanmış güncel küresel birey sayısı için standart bir gerçek zamanlı açık veri tabanı bulunmamaktadır.',
    wikipediaTitle: 'Haflinger',
    sourceUrl: 'https://en.wikipedia.org/wiki/Haflinger',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'shetland-pony',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil Midilli / Pony Irkı)',
    turkishName: 'Shetland Pony',
    internationalName: 'Shetland Pony',
    aliases: ['shetland pony', 'shetland midillisi', 'shetland', 'sheltie pony'],
    category: 'pony_feral_nordic',
    categoryLabel: 'Pony, Ada & Yabanıllaşmış Popülasyonlar',
    originCountryOrRegion: 'Shetland Adaları (İskoçya)',
    distinguishingTraits: [
      'Cüssesine oranla olağanüstü çekme ve taşıma gücüne sahip küçük yapılı midilli (pony) ırkı',
      'Soğuk ve rüzgarlı ada iklimine uyumlu kalın kışlık kürk, gür yele ve kısa güçlü bacaklar',
      'Tarihsel olarak çiftlik taşımacılığı ve maden ocaklarında (pit pony) kullanılmıştır',
    ],
    summary:
      'İskoçya’nın kuzeyindeki Shetland Adaları’nda Tunç Çağı’ndan beri varlığı bilinen dayanıklı hatlardan gelen Shetland Pony, sert iklim koşullarına dayanıklılığı, kalın tüy örtüsü ve cüssesine göre yüksek gücüyle bilinen küçük bir at ırkıdır.',
    distributionAndPopulationNote:
      'Shetland Pony, Equus caballus türüne ait bir midilli ırkıdır; GBIF üzerinde ayrı ırk gözlem/dağılım sayacı bulunmaz. Açık erişimli küresel popülasyon sayımı verisi mevcut değildir.',
    wikipediaTitle: 'Shetland pony',
    sourceUrl: 'https://en.wikipedia.org/wiki/Shetland_pony',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'shire-ati',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil Ağır Çeki Irkı)',
    turkishName: 'Shire Atı',
    internationalName: 'Shire Horse',
    aliases: ['shire atı', 'shire ati', 'shire', 'shire horse'],
    category: 'draft_carriage',
    categoryLabel: 'Koşum, Dresaj & Hafif Çeki Atı',
    originCountryOrRegion: 'İngiltere (Birleşik Krallık)',
    distinguishingTraits: [
      'Dünyanın en iri ve en yüksek omuz yüksekliğine ulaşabilen ağır çeki (draft) atı ırklarından biri',
      'Alt bacaklarda ve toynak üzerinde yoğun uzun tüy (feathering) yapısı',
      'Tarihsel olarak tarım, kanal mavnası çekimi ve ağır yük arabalarında yüksek çekiş gücü',
    ],
    summary:
      'İngiltere kökenli Shire Atı, yüksek ağırlık çekme kapasitesi ve heybetli cüssesiyle bilinen klasik bir ağır çeki ırkıdır. Sanayi öncesi ve erken sanayi dönemlerinde tarım ve ağır yük taşımacılığında önemli rol oynamıştır.',
    distributionAndPopulationNote:
      'GBIF kayıtları Equus caballus türü genelinde tutulur; Shire Atı için ayrı bir GBIF gözlem veya dağılım sayacı bulunmamaktadır. Açık kaynaklarda nadirleşen geleneksel çeki ırkları arasında anılsa da güncel küresel popülasyon sayısı standart olarak raporlanmamaktadır.',
    wikipediaTitle: 'Shire horse',
    sourceUrl: 'https://en.wikipedia.org/wiki/Shire_horse',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'clydesdale',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil Ağır Çeki Irkı)',
    turkishName: 'Clydesdale',
    internationalName: 'Clydesdale',
    aliases: ['clydesdale', 'clydesdale horse', 'clydesdale atı'],
    category: 'draft_carriage',
    categoryLabel: 'Koşum, Dresaj & Hafif Çeki Atı',
    originCountryOrRegion: 'Clydesdale Bölgesi (İskoçya)',
    distinguishingTraits: [
      '17. yüzyılda İskoçya’nın Clydesdale yöresinde geliştirilmiş iri yapılı çeki atı ırkı',
      'Genellikle beyaz çoraplı (sabino) bacaklar, yüzde beyaz akıtma ve yoğun bacak tüyleri (feathering)',
      'Ağır çeki atlarına kıyasla aktif, yüksek adımlı ve gösterişli yürüyüş stili',
    ],
    summary:
      'Adını İskoçya’daki Clyde Nehri vadisinden (Clydesdale) alan bu çeki atı ırkı, ilk kez 1826’da bu isimle kaydedilmiştir. Güçlü çekiş kapasitesinin yanı sıra beyaz bacak işaretlemeleri ve yüksek adımlı yürüyüşü ile dikkat çeker.',
    distributionAndPopulationNote:
      'Clydesdale için GBIF üzerinde ayrı bir ırk gözlem/yayılış sayacı yoktur (biyolojik tür: Equus caballus). Küresel ölçekte gerçek zamanlı doğrulanmış popülasyon verisi bulunmamaktadır.',
    wikipediaTitle: 'Clydesdale horse',
    sourceUrl: 'https://en.wikipedia.org/wiki/Clydesdale_horse',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'lipizzan',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil At Irkı)',
    turkishName: 'Lipizzan',
    internationalName: 'Lipizzan (Lipizzaner)',
    aliases: ['lipizzan', 'lipizzaner', 'lipizzan atı'],
    category: 'riding_racing',
    categoryLabel: 'Binek, Dayanıklılık & Yarış Atı',
    originCountryOrRegion: 'Habsburg İmparatorluğu / Lipica (Günümüz Slovenya)',
    distinguishingTraits: [
      'Koyu renkte (siyah/doru) doğup yaş aldıkça kademeli olarak tamamen kır/beyaz renge dönen don özelliği',
      '16. yüzyılda geliştirilen, geç olgunlaşan ancak uzun ömürlü ve güçlü kas yapısına sahip ırk',
      'Viyana İspanyol Binicilik Okulu’nun klasik yüksek okul (haute école) hareketleriyle özdeşleşmiştir',
    ],
    summary:
      '16. yüzyılda Habsburg İmparatorluğu döneminde Lipica (günümüzde Slovenya) harasında geliştirilen Lipizzan, İspanyol, İtalyan ve yerel Avrupa at hatlarından beslenen bir klasik dresaj ve binek ırkıdır.',
    distributionAndPopulationNote:
      'GBIF tür kayıtları Equus caballus kapsamında tutulduğu için Lipizzan ırkına ait ayrı gözlem veya dağılım sayacı bulunmamaktadır. Açık erişimli standart küresel popülasyon verisi mevcut değildir.',
    wikipediaTitle: 'Lipizzan',
    sourceUrl: 'https://en.wikipedia.org/wiki/Lipizzan',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'percheron',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil Ağır Çeki Irkı)',
    turkishName: 'Percheron',
    internationalName: 'Percheron',
    aliases: ['percheron', 'percheron atı'],
    category: 'draft_carriage',
    categoryLabel: 'Koşum, Dresaj & Hafif Çeki Atı',
    originCountryOrRegion: 'Eski Perche Bölgesi (Batı Fransa)',
    distinguishingTraits: [
      'Ağırlıklı olarak kır (gri) veya yağız (siyah) don rengi ve ağır çeki ırklarına göre daha temiz/kısa bacak tüyleri',
      'Güçlü kas yapısı, yüksek zeka ve ağır işe uyumlu uysal mizaç',
      'Fransa’nın Huisne Nehri vadisinden dünyaya yayılan çok yönlü ağır çeki ve koşum atı',
    ],
    summary:
      'Batı Fransa’nın eski Perche bölgesinden köken alan Percheron, hem ağır tarım ve yük çekiminde hem de hızlı koşum işlerinde kullanılan kaslı, zeki ve dayanıklı bir çeki atı ırkıdır.',
    distributionAndPopulationNote:
      'Percheron için GBIF üzerinde ırk düzeyinde ayrı gözlem veya yayılış sayacı bulunmaz (bilimsel tür: Equus caballus). Doğrulanmış güncel küresel nüfus verisi mevcut değildir.',
    wikipediaTitle: 'Percheron',
    sourceUrl: 'https://en.wikipedia.org/wiki/Percheron',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'quarter-horse',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil At Irkı)',
    turkishName: 'Quarter Horse',
    internationalName: 'American Quarter Horse',
    aliases: ['quarter horse', 'american quarter horse', 'amerikan quarter horse', 'quarter atı'],
    category: 'riding_racing',
    categoryLabel: 'Binek, Dayanıklılık & Yarış Atı',
    originCountryOrRegion: 'Amerika Birleşik Devletleri (17. yüzyıldan itibaren)',
    distinguishingTraits: [
      'Çeyrek mil (yaklaşık 400 m) ve altı kısa mesafelerde patlayıcı hızlanma ve yüksek sprint sürati',
      'Güçlü arka sağrı kasları, kompakt gövde ve hızlı manevra kabiliyeti',
      'Sığır güdümü, rodeo ve kısa mesafe yarışlarında yaygın kullanım',
    ],
    summary:
      'Adını çeyrek mil (quarter mile) mesafedeki üstün kısa mesafe süratinden alan American Quarter Horse, 1600’lü yıllardan itibaren Kuzey Amerika’da şekillendirilmiş kompakt, kaslı ve çok çevik bir binek atı ırkıdır.',
    distributionAndPopulationNote:
      'GBIF kayıtları Equus caballus biyolojik türü altında toplandığından Quarter Horse için ayrı bir GBIF gözlem veya dağılım sayacı bulunmamaktadır. Açık erişimli gerçek zamanlı küresel popülasyon verisi mevcut değildir.',
    wikipediaTitle: 'American Quarter Horse',
    sourceUrl: 'https://en.wikipedia.org/wiki/American_Quarter_Horse',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
  {
    slug: 'izlanda-ati',
    classificationKind: 'DOMESTIC_BREED',
    scientificSpecies: 'Equus caballus',
    scientificClassificationLabel: 'Equus caballus Linnaeus, 1758 (Evcil Ada Atı Irkı)',
    turkishName: 'İzlanda Atı',
    internationalName: 'Icelandic Horse',
    aliases: ['izlanda atı', 'izlanda ati', 'icelandic horse', 'icelandic'],
    category: 'pony_feral_nordic',
    categoryLabel: 'Pony, Ada & Yabanıllaşmış Popülasyonlar',
    originCountryOrRegion: 'İzlanda',
    distinguishingTraits: [
      'Klasik yürüyüşlerin yanında "tölt" ve "skeið" adı verilen ek doğal yürüyüş biçimlerine sahip olması',
      'Yüzyıllardır süren katı ithalat yasağı sayesinde dış melezlemeden korunmuş izole ada soyu',
      'Midilli boyutuna yakın boyuna rağmen yüksek dayanıklılık ve uzun ömür',
    ],
    summary:
      'İzlanda’da Viking yerleşimlerinden bu yana yetiştirilen İzlanda Atı, coğrafi izolasyon ve katı biyolojik koruma kuralları sayesinde saflığını koruyan, ek doğal yürüyüş biçimleri (tölt) ile ünlü dayanıklı bir kuzey atı ırkıdır.',
    distributionAndPopulationNote:
      'İzlanda Atı ayrı bir biyolojik tür değil Equus caballus türüne ait izole bir ırktır; GBIF üzerinde ayrı ırk gözlem/yayılış sayacı bulunmaz. Gerçek zamanlı standart küresel popülasyon verisi sunulmamaktadır.',
    wikipediaTitle: 'Icelandic horse',
    sourceUrl: 'https://en.wikipedia.org/wiki/Icelandic_horse',
    sourceName: 'Wikipedia / Wikimedia Commons',
  },
];

function foldTr(text: string): string {
  return (text || '')
    .normalize('NFC')
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035']/g, "'")
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const HORSE_BREED_CATALOG_ALIASES = new Set<string>([
  'at',
  'atlar',
  'evcil at',
  'at irklari',
  'at irki',
  'horse',
  'horses',
  'horse breed',
  'horse breeds',
  'domestic horse',
]);

/**
 * Yalnızca genel "At" / "At Irkları" aramalarını At Irkları keşif kataloğuna yönlendirir.
 * "Equus caballus", "Tibet atı", "At sineği", "Arap atı", "Zebra" veya "Eşek" için false döner.
 */
export function isHorseBreedCatalogQuery(query: string): boolean {
  const folded = foldTr(query);
  return HORSE_BREED_CATALOG_ALIASES.has(folded);
}

/**
 * Doğrudan belirli bir at ırkı adı arandığında (ör. "Arap Atı", "Akhal-Teke", "Frizyen Atı", "Thoroughbred")
 * ilgili tekil at ırkı kaydını döndürür.
 */
export function resolveHorseBreedQuery(query: string): HorseBreedRecord | null {
  const folded = foldTr(query);
  if (!folded || isHorseBreedCatalogQuery(folded)) return null;
  for (const breed of HORSE_BREEDS_CATALOG) {
    if (foldTr(breed.slug) === folded) return breed;
    if (foldTr(breed.turkishName) === folded) return breed;
    if (foldTr(breed.internationalName) === folded) return breed;
    for (const alias of breed.aliases) {
      if (foldTr(alias) === folded) return breed;
    }
  }
  return null;
}

export function getHorseBreedBySlug(slug: string): HorseBreedRecord | null {
  const clean = (slug || '').trim().toLowerCase();
  if (!clean) return null;
  return HORSE_BREEDS_CATALOG.find((b) => b.slug === clean) || null;
}

interface CachedBreedPhotoEntry {
  photoUrl: string;
  sourceTitle: string;
  expiresAt: number;
}

const BREED_PHOTO_CACHE = new Map<string, CachedBreedPhotoEntry>();
let inFlightBatchPromise: Promise<Record<string, { photoUrl: string; sourceTitle: string }>> | null = null;

/**
 * Wikipedia MediaWiki Action API üzerinden tek toplu istek (HTTP 200 güvenli) ile
 * ırk görsellerini alır ve sunucu taraflı /api/media/verify-batch ile MIME/magic-byte doğrulamasından geçirir.
 */
export async function fetchVerifiedHorseBreedPhotos(
  breeds: HorseBreedRecord[] = HORSE_BREEDS_CATALOG
): Promise<Record<string, { photoUrl: string; sourceTitle: string }>> {
  const now = Date.now();
  const output: Record<string, { photoUrl: string; sourceTitle: string }> = {};
  const missingBreeds: HorseBreedRecord[] = [];

  for (const b of breeds) {
    const cached = BREED_PHOTO_CACHE.get(b.slug);
    if (cached && cached.expiresAt > now) {
      if (cached.photoUrl) {
        output[b.slug] = { photoUrl: cached.photoUrl, sourceTitle: cached.sourceTitle };
      }
    } else {
      missingBreeds.push(b);
    }
  }

  if (missingBreeds.length === 0) return output;

  if (inFlightBatchPromise && missingBreeds.length === breeds.length) {
    return inFlightBatchPromise;
  }

  const runner = (async () => {
    try {
      const titles = missingBreeds.map((b) => b.wikipediaTitle).join('|');
      const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
        titles
      )}&redirects=1&prop=pageimages&pithumbsize=640&format=json&origin=*`;

      const res = await fetch(apiUrl);
      if (!res.ok) return output;
      const json = await res.json();

      // Redirects & normalized title resolution
      const normalizedMap = new Map<string, string>();
      for (const n of json?.query?.normalized || []) {
        if (n?.from && n?.to) normalizedMap.set(String(n.from), String(n.to));
      }
      const redirectMap = new Map<string, string>();
      for (const r of json?.query?.redirects || []) {
        if (r?.from && r?.to) redirectMap.set(String(r.from), String(r.to));
      }

      const pagesByTitle = new Map<string, any>();
      for (const p of Object.values<any>(json?.query?.pages || {})) {
        if (p?.title) pagesByTitle.set(String(p.title), p);
      }

      const candidateUrlsBySlug = new Map<string, { url: string; title: string }>();
      for (const b of missingBreeds) {
        let lookup = b.wikipediaTitle;
        if (normalizedMap.has(lookup)) lookup = normalizedMap.get(lookup)!;
        if (redirectMap.has(lookup)) lookup = redirectMap.get(lookup)!;
        const page = pagesByTitle.get(lookup);
        const thumbUrl = page?.thumbnail?.source;
        if (typeof thumbUrl === 'string' && thumbUrl.startsWith('https://')) {
          candidateUrlsBySlug.set(b.slug, { url: thumbUrl, title: page?.title || b.wikipediaTitle });
        }
      }

      const candidateUrls = Array.from(candidateUrlsBySlug.values()).map((c) => c.url);
      if (candidateUrls.length > 0) {
        const verifiedMap = await verifyImageAssetUrlsBatch(candidateUrls, 15000);
        for (const [slug, cand] of candidateUrlsBySlug.entries()) {
          const check = verifiedMap.get(cand.url);
          if (check?.verified) {
            output[slug] = { photoUrl: cand.url, sourceTitle: cand.title };
            if (!check.unverifiedFallback) {
              BREED_PHOTO_CACHE.set(slug, {
                photoUrl: cand.url,
                sourceTitle: cand.title,
                expiresAt: Date.now() + 30 * 60 * 1000,
              });
            }
          } else if (!isTransientMediaVerifyFailure(check)) {
            BREED_PHOTO_CACHE.set(slug, {
              photoUrl: '',
              sourceTitle: cand.title,
              expiresAt: Date.now() + 5 * 60 * 1000,
            });
          }
        }
      }
    } catch {
      // Görsel doğrulaması başarısız olursa doğrulanmamış görsel gösterme
    }
    return output;
  })();

  if (missingBreeds.length === breeds.length) {
    inFlightBatchPromise = runner.finally(() => {
      inFlightBatchPromise = null;
    });
    return inFlightBatchPromise;
  }

  return runner;
}
