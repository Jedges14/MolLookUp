const molecules = [
    {
        "name": "Caffeine",
        "formula": "C8H10N4O2",
        "weight": 194.19,
        "funFact": "A natural stimulant found in coffee and tea.",
        "cid": 2519,
        "summary": "First isolated from coffee in 1819 by German chemist Friedlieb Ferdinand Runge, who was encouraged by Goethe. "
    },
    {
        "name": "Serotonin",
        "formula": "C10H12N2O",
        "weight": 176.22,
        "funFact": "Regulates mood, sleep, and appetite.",
        "cid": 5202,
        "summary": "Discovered in 1948 by Maurice Rapport, Arda Green, and Irvine Page during research on blood serum. "
    },
    {
        "name": "LSD",
        "formula": "C20H25N3O",
        "weight": 323.44,
        "funFact": "A powerful hallucinogen active at microgram doses.",
        "cid": 8223,
        "summary": "Synthesized in 1938 by Albert Hofmann at Sandoz Labs. Its hallucinogenic effects were discovered in 1943. Later used in unethical MK-Ultra experiments."
    },
    {
        "name": "Psilocybin",
        "formula": "C12H17N2O4P",
        "weight": 284.25,
        "funFact": "The active compound in magic mushrooms.",
        "cid": 10624,
        "summary": "Naturally occurring psychedelic used in spiritual practices for centuries. Isolated in 1958 by Albert Hofmann. Historically associated with cultural and legal controversy."
    },
    {
        "name": "Aspirin",
        "formula": "C9H8O4",
        "weight": 180.16,
        "funFact": "First synthesized in 1897, revolutionized pain relief.",
        "cid": 2244,
        "summary": "Developed by Felix Hoffmann at Bayer in 1897. Widely used for pain and cardiovascular health. "
    },
    {
        "name": "Glucose",
        "formula": "C6H12O6",
        "weight": 180.16,
        "funFact": "Primary source of energy for living organisms.",
        "cid": 5793,
        "summary": "Known since the early 18th century. First isolated in 1747 by Andreas Marggraf."
    },
    {
        "name": "Dopamine",
        "formula": "C8H11NO2",
        "weight": 153.18,
        "funFact": "Controls the brain's reward and pleasure centers.",
        "cid": 681,
        "summary": "Discovered by Kathleen Montagu in 1957. Plays essential roles in brain function and mood regulation. "
    },
    {
        "name": "Water",
        "formula": "H2O",
        "weight": 18.02,
        "funFact": "Essential for all known forms of life.",
        "cid": 962,
        "summary": "Known since antiquity. Studied extensively in modern chemistry by Lavoisier and Cavendish. "
    },
    {
        "name": "Acetaminophen",
        "formula": "C8H9NO2",
        "weight": 151.16,
        "funFact": "Also known as paracetamol, widely used pain reliever.",
        "cid": 1983,
        "summary": "Discovered in 1877 and introduced in the 1950s. Associated with liver toxicity in overdose."
    },
    {
        "name": "Nicotine",
        "formula": "C10H14N2",
        "weight": 162.23,
        "funFact": "Highly addictive alkaloid found in tobacco plants.",
        "cid": 89594,
        "summary": "Isolated in 1828 by Posselt and Reimann. Historically tied to the tobacco industry and health crises."
    },
    {
        "name": "Morphine",
        "formula": "C17H19NO3",
        "weight": 285.34,
        "funFact": "Powerful opioid analgesic isolated from opium poppy.",
        "cid": 5288826,
        "summary": "Isolated by Friedrich Sertürner in 1804. Critical in pain management but central to opioid addiction epidemics."
    },
    {
        "name": "Penicillin G",
        "formula": "C16H18N2O4S",
        "weight": 334.39,
        "funFact": "First true antibiotic, discovered by Alexander Fleming.",
        "cid": 5904,
        "summary": "Discovered by Alexander Fleming in 1928. Revolutionized infection treatment. "
    },
    {
        "name": "Vitamin C",
        "formula": "C6H8O6",
        "weight": 176.12,
        "funFact": "Essential vitamin that prevents scurvy.",
        "cid": 54670067,
        "summary": "Isolated by Albert Szent-Györgyi in the 1930s. Crucial for immune function. "
    },
    {
        "name": "DNA Base Adenine",
        "formula": "C5H5N5",
        "weight": 135.13,
        "funFact": "One of the four nucleotide bases in DNA.",
        "cid": 190,
        "summary": "Identified as a component of nucleic acids in the late 19th century. Key role in DNA structure discovered by Watson and Crick. "
    },
    {
        "name": "Ibuprofen",
        "formula": "C13H18O2",
        "weight": 206.28,
        "funFact": "Common NSAID developed in the 1960s.",
        "cid": 3672,
        "summary": "Developed by Stewart Adams in 1961. Widely used anti-inflammatory drug. "
    },
    {
        "name": "Methane",
        "formula": "CH4",
        "weight": 16.04,
        "funFact": "Simplest hydrocarbon and major greenhouse gas.",
        "cid": 297,
        "summary": "Identified by Alessandro Volta in the 1770s. Contributes to global warming."
    },
    {
        "name": "Ethanol",
        "formula": "C2H6O",
        "weight": 46.07,
        "funFact": "The type of alcohol found in alcoholic beverages.",
        "cid": 702,
        "summary": "Used since antiquity, chemically characterized in the 1800s. Historical links to addiction and health issues."
    },
    {
        "name": "Insulin",
        "formula": "C254H377N65O75S6",
        "weight": 5808.0,
        "funFact": "Hormone that regulates blood sugar levels.",
        "cid": 6926,
        "summary": "Discovered in 1921 by Frederick Banting and Charles Best. Revolutionized diabetes treatment. "
    },
    {
        "name": "Cholesterol",
        "formula": "C27H46O",
        "weight": 386.65,
        "funFact": "Essential sterol for cell membrane function.",
        "cid": 5997,
        "summary": "Identified in bile stones in the 18th century. Associated with cardiovascular diseases."
    },
    {
        "name": "Codeine",
        "formula": "C18H21NO3",
        "weight": 299.36,
        "funFact": "Opioid analgesic and cough suppressant.",
        "cid": 5284371,
        "summary": "Isolated in 1832 by Pierre Robiquet. Effective for mild pain but linked to opioid dependency."
    },
    {
        "name": "Testosterone",
        "formula": "C19H28O2",
        "weight": 288.42,
        "funFact": "Primary male sex hormone.",
        "cid": 6013,
        "summary": "Isolated in 1935 by Ernst Laqueur. Used in hormone therapy and performance enhancement. "
    },
    {
        "name": "Hemoglobin",
        "formula": "C2952H4664N812O832S8Fe4",
        "weight": 64500.0,
        "funFact": "Protein that carries oxygen in blood.",
        "cid": 443,
        "summary": "Discovered in the mid-1800s; structure solved by Max Perutz in 1959. Central to physiology. "
    },
    {
        "name": "Vanillin",
        "formula": "C8H8O3",
        "weight": 152.15,
        "funFact": "Primary component of vanilla bean extract.",
        "cid": 1183,
        "summary": "Isolated in the 19th century; first synthesized in 1874 from coniferin. "
    },
    {
        "name": "Capsaicin",
        "formula": "C18H27NO3",
        "weight": 305.41,
        "funFact": "Chemical that makes chili peppers hot.",
        "cid": 1548943,
        "summary": "Isolated in 1816 and structurally confirmed in 1919. Used in pain relief creams. "
    },
    {
        "name": "Theobromine",
        "formula": "C7H8N4O2",
        "weight": 180.16,
        "funFact": "Bitter alkaloid found in chocolate and tea.",
        "cid": 5429,
        "summary": "Isolated from cocoa in the 1840s. Related to caffeine."
    }
]

export default molecules;
