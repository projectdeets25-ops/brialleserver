// index.js - Single-file Notes Maker Server (Gemini version)

require("dotenv").config(); // Load environment variables from .env file
const express = require("express");
const multer = require("multer");
const mongoose = require("mongoose");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { saveNotes, generateMultiLanguageNotes } = require("./controllers/noteController");
const notesRoutes = require("./routes/notes");
const { SYSTEM_INSTRUCTIONS } = require("./config/systemInstructions");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GEMINI_API_KEY;

// Global variable to track database connection status
let isDatabaseConnected = false;

// Database connection function
const connectDB = async () => {
    try {
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri) {
            console.warn('⚠️ MONGO_URI environment variable is not set. Database features will be disabled.');
            return false;
        }
        
        // Check if already connected
        if (mongoose.connection.readyState === 1) {
            console.log('✅ MongoDB Already Connected');
            return true;
        }
        
        // For serverless environments, use connection pooling
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            bufferCommands: false
        });
        
        console.log('✅ MongoDB Connected Successfully');
        return true;
    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error.message);
        console.warn('⚠️ Continuing without database connection...');
        return false;
    }
};

// Ensure database connection for each request
const ensureDBConnection = async () => {
    if (!isDatabaseConnected) {
        console.log('🔄 Attempting to connect to database...');
        isDatabaseConnected = await connectDB();
    }
    return isDatabaseConnected;
};

// Using Gemini 2.5 Flash Lite model
const GEMINI_MODEL = "gemini-2.5-flash-lite";

if (!API_KEY) {
  console.error("FATAL: GEMINI_API_KEY not found in .env file.");
  console.error("Please create a .env file with your GEMINI_API_KEY and MONGO_URI.");
  process.exit(1);
}

// Initialize Gemini AI with English system instruction as default
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ 
  model: GEMINI_MODEL,
  systemInstruction: SYSTEM_INSTRUCTIONS.ENGLISH
});

// Create models for different languages
const models = {
  english: genAI.getGenerativeModel({ 
    model: GEMINI_MODEL,
    systemInstruction: SYSTEM_INSTRUCTIONS.ENGLISH
  }),
  hindi: genAI.getGenerativeModel({ 
    model: GEMINI_MODEL,
    systemInstruction: SYSTEM_INSTRUCTIONS.HINDI
  }),
  braille: genAI.getGenerativeModel({ 
    model: GEMINI_MODEL,
    systemInstruction: SYSTEM_INSTRUCTIONS.BRAILLE
  })
};

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept audio files and any other files
    if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('text/') || file.fieldname === 'content') {
      cb(null, true);
    } else {
      cb(new Error('Only audio and text files are allowed!'), false);
    }
  }
});

// CORS middleware to allow all origins
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

// --- Health Check Endpoint ---
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date().toISOString() });
});

// --- Database Status Endpoint ---
app.get("/api/db-status", async (req, res) => {
  const dbConnected = await ensureDBConnection();
  res.status(200).json({ 
    database_connected: dbConnected,
    mongoose_state: mongoose.connection.readyState,
    mongo_uri_set: !!process.env.MONGO_URI,
    timestamp: new Date().toISOString()
  });
});

// --- Optional Root Route ---
app.get("/", (req, res) => {
  res.send("Welcome to the AI Notes Maker Server (Gemini Powered) - Multi-Language Support (English, Hindi, Braille)");
});

// --- Language-specific Notes Endpoint ---
app.get("/generate-notes/:noteId/:language", async (req, res) => {
  const { noteId, language } = req.params;
  
  if (!['english', 'hindi', 'braille'].includes(language)) {
    return res.status(400).json({
      error: 'Invalid language. Must be one of: english, hindi, braille'
    });
  }

  try {
    const dbConnected = await ensureDBConnection();
    if (!dbConnected) {
      return res.status(503).json({
        error: 'Database not connected'
      });
    }

    const Note = require('./models/Note');
    const note = await Note.findById(noteId);
    
    if (!note) {
      return res.status(404).json({
        error: 'Note not found'
      });
    }

    res.json({
      status: 'success',
      note_id: noteId,
      language: language,
      generated_notes: note.generatedNotes[language],
      detected_language: note.detectedLanguage,
      detected_subject: note.detectedSubject,
      created_at: note.createdAt
    });
  } catch (error) {
    console.error('Error fetching language-specific note:', error);
    res.status(500).json({
      error: 'Failed to fetch note',
      details: error.message
    });
  }
});

// --- Notes Generation Endpoint ---
app.post("/generate-notes", upload.fields([
  { name: 'type', maxCount: 1 },
  { name: 'content', maxCount: 1 }
]), async (req, res) => {
  console.log("Request body:", req.body);
  console.log("Request files:", req.files);
  console.log("Request headers:", req.headers);
  
  const type = req.body.type;
  let content = req.body.content;

  // If content is uploaded as a file, read it
  if (req.files && req.files.content && req.files.content[0]) {
    const file = req.files.content[0];
    console.log("File uploaded:", file.originalname, file.mimetype, file.size);
    
    if (file.mimetype.startsWith('audio/')) {
      // For audio files, we'll process the actual file
      content = file; // Store the file object for processing
      console.log("Audio file received for processing:", file.originalname, file.mimetype, file.size);
    } else if (file.mimetype.startsWith('text/')) {
      // For text files, read the content
      content = file.buffer.toString('utf8');
      console.log("Text file content read");
    }
  }

  if (!type || !content) {
    return res.status(400).json({ 
      error: 'Missing "type" or "content" in the form data.',
      received_body: req.body,
      received_files: req.files,
      received_headers: req.headers
    });
  }

  try {
    let userPrompt = "";
    let audioFile = null;
    let detectedLanguage = "unknown";
    let detectedSubject = "General";

    // Function to detect language from text content
    const detectLanguage = async (text) => {
      try {
        const detectionResult = await model.generateContent({
          contents: [{ 
            role: "user", 
            parts: [{ 
              text: `Identify the language of this text. Respond with ONLY the language name in English (e.g., "English", "Spanish", "French", "Hindi", "Kannada", "Tamil", "Telugu", "Bengali", "Gujarati", "Marathi", "Punjabi", "Chinese", "Japanese", "Korean", "Arabic", "German", "Italian", "Portuguese", "Russian", etc.). Do not include any other text or explanation:

"${text.substring(0, 500)}"` 
            }] 
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 20,
          },
        });
        const detectedLang = detectionResult.response.text().trim();
        // Clean up any extra text that might come with the response
        const cleanLang = detectedLang.split('\n')[0].split('.')[0].trim();
        console.log("Raw language detection:", detectedLang);
        console.log("Cleaned language:", cleanLang);
        return cleanLang;
      } catch (error) {
        console.warn("Language detection failed:", error.message);
        return "unknown";
      }
    };

    // --- Ensemble subject detection (formatting, model, heuristic, decision, post-check)
    function formatForSubjectDetection(raw) {
      if (!raw || typeof raw !== 'string') return '';
      const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (!lines.length) return '';
      const title = lines.find(l => l.length < 120) || lines[0];
      const headings = lines.filter(l => /^#+\s+/.test(l) || (l === l.toUpperCase() && l.split(' ').length < 8));
      const mathRegex = /\\frac|\\int|sin\(|cos\(|tan\(|lim\b|\d+\s*=|=>|<=|>=/i;
      const mathLines = lines.filter(l => mathRegex.test(l));
      const unitRegex = /\b(m|cm|kg|mol|N|J|Hz|K|ppm)\b/i;
      const unitLines = lines.filter(l => unitRegex.test(l));
      const signalRegex = /\b(definition|theorem|proof|example|algorithm|reaction|exercise)\b/i;
      const signalLines = lines.filter(l => signalRegex.test(l));
      const head = lines.slice(0, 60);
      const parts = [title, ...headings.slice(0,6), ...mathLines.slice(0,12), ...unitLines.slice(0,8), ...signalLines.slice(0,10), ...head];
      return parts.filter(Boolean).join('\n').slice(0, 4000);
    }

    async function modelDetectSubject(modelClient, rawText, allowedSubjects) {
      const excerpt = formatForSubjectDetection(rawText) || (rawText && rawText.substring(0,2000)) || '';
      const allowedList = allowedSubjects.map(s => `"${s}"`).join(', ');
      const prompt = `Identify ONE subject from: ${allowedList}. Reply with ONLY that subject (no extra text).\n\nExcerpt:\n"${excerpt}"`;

      const resp = await modelClient.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 40 }
      });

      return (resp.response.text() || '').split('\n')[0].trim();
    }

    function heuristicScores(text, keywordMap) {
      const t = (text || '').toLowerCase();
      const scores = {};
      for (const [subject, kws] of Object.entries(keywordMap)) {
        let score = 0;
        for (const kw of kws) if (kw && t.includes(kw.toLowerCase())) score++;
        scores[subject] = score;
      }
      return scores;
    }

    function decideSubject(modelLabel, scores, synonyms = {}) {
      const normalized = modelLabel ? modelLabel.trim() : null;
      const sorted = Object.entries(scores).sort((a,b) => b[1]-a[1]);
      const top = sorted[0] || [null,0];
      const second = sorted[1] || [null,0];
      if (top[1] >= 3 && (top[1] - (second[1]||0) >= 2)) return top[0];
      if (normalized) {
        const lower = normalized.toLowerCase();
        if (synonyms[lower]) return synonyms[lower];
        if (Object.keys(scores).some(s => s.toLowerCase() === lower)) {
          return Object.keys(scores).find(s => s.toLowerCase() === lower);
        }
      }
      if (scores['Sports'] >= 2) return 'Sports';
      if (top[1] > 0) return top[0];
      return 'General';
    }

    function postDetectOverride(generatedNotes, originalContent, smallKeywordMap, currentSubject) {
      const combined = ((generatedNotes||'') + '\n' + (typeof originalContent === 'string' ? originalContent : '')).toLowerCase();
      for (const subj of Object.keys(smallKeywordMap)) {
        if (combined.includes(subj.toLowerCase())) return subj;
      }
      const scores = {};
      for (const [s, kws] of Object.entries(smallKeywordMap)) {
        scores[s] = kws.reduce((acc, kw) => acc + (combined.includes(kw) ? 1 : 0), 0);
      }
      const sorted = Object.entries(scores).sort((a,b) => b[1]-a[1]);
      if (sorted[0] && sorted[0][1] >= 2) return sorted[0][0];
      return currentSubject;
    }

    const keywordMap = {
      Mathematics: [
        'algebra','calculus','integral','derivative','matrix','theorem','proof','equation','geometry','trigonometry',
        'probability','statistics','mean','median','variance','limit','vector','tensor','differentiation','integration',
        'logarithm','exponent','function','linear algebra','quadratic','polynomial','number theory','set theory','topology',
        'complex numbers','factorization','inequality','series','sequence','arithmetic','geometric progression','graph theory',
        'combinatorics','permutation','combination','optimization','probability distribution','regression','coordinate geometry',
        'differential equations','multivariable calculus','z score','standard deviation','p value','chi square','binomial',
        'normal distribution','integration by parts','laplace transform','fourier transform','hyperbola','ellipse'
      ],
    
      Physics: [
        'force','velocity','acceleration','quantum','electron','photon','momentum','energy','thermodynamics','entropy',
        'relativity','gravity','newton','magnetism','electricity','voltage','current','resistance','magnetic field','wave',
        'frequency','amplitude','optics','refraction','diffraction','nuclear','particle','mass','inertia','pressure',
        'density','work','power','kinematics','dynamics','scalar','vector','torque','angular momentum','black hole',
        'string theory','cosmology','astrophysics','plasma','superconductivity','circuit','charge','radiation','heat transfer',
        'vacuum','friction','centripetal force','centrifugal force','harmonic motion','resonance','photoelectric effect','quantum field',
        'uncertainty principle','higgs boson','fusion','fission'
      ],
      
      Chemistry: [
        'chemical','molecule','reaction','stoichiometry','acid','base','ion','ph','organic','inorganic',
        'oxidation','reduction','titration','catalyst','enzyme','bond','covalent','ionic','metallic','hydrocarbon',
        'polymer','solvent','solute','solution','precipitate','equilibrium','kinetics','thermochemistry','entropy',
        'enthalpy','alkane','alkene','alkyne','aromatic','isomer','electronegativity','periodic table','atomic mass',
        'valence','buffer','salt','ester','amine','aldehyde','ketone','carboxylic acid','spectroscopy','chromatography',
        'nucleophile','electrophile','free radical','halogenation','hydrogen bond','pi bond','sigma bond','radioactivity',
        'pKa','molarity','avogadro number','lattice energy'
      ],
      
      Biology: [
        'cell','dna','rna','genome','evolution','photosynthesis','enzyme','protein','organism','species',
        'ecology','mitosis','meiosis','chromosome','mutation','gene','allele','protein synthesis','transcription','translation',
        'ribosome','mitochondria','chloroplast','cell membrane','cytoplasm','nucleus','bacteria','virus','fungi',
        'taxonomy','phylogeny','adaptation','natural selection','ecosystem','biosphere','population','microbiology','immunity',
        'hormone','respiration','circulation','digestion','nervous system','endocrine system','genetic drift','stem cells',
        'homeostasis','antibody','antigen','cloning','reproduction','fermentation','amino acid','lipid','carbohydrate','metabolism',
        'epigenetics','symbiosis','cell division','pathogen'
      ],      
    
      ComputerScience: [
        'algorithm','data structure','binary','byte','cache','compiler','complexity','big o','hash map','tree',
        'graph','neural network','machine learning','database','sql','operating system','cpu','ram','thread','process',
        'parallelism','distributed systems','networking','encryption','compression','search algorithm','sorting','stack','queue',
        'linked list','heap','priority queue','hashing','api','protocol','tcp','udp','rest','virtualization',
        'cloud','container','docker','kubernetes','recursion','backtracking','dynamic programming','computer vision','nlp',
        'deep learning','transformer','blockchain','gpu','query optimization','transactions','deadlock','load balancing','caching','filesystem'
      ],
    
      Programming: [
        'function','variable','loop','if statement','for loop','while loop','javascript','python','java','c++',
        'c#','golang','rust','typescript','react','node','async','await','exception','class',
        'object','inheritance','polymorphism','encapsulation','interface','pointer','reference','module','package','library',
        'framework','mongo','firebase','api call','json','xml','debugging','testing','unit test','deployment',
        'compiler','interpreter','lambda','closure','arrow function','promise','callback','rest parameters','vue','angular',
        'sql query','regex','event listener','http request','version control','git','repository','branch','merge','websocket'
      ],
    
      History: [
        'empire','war','revolution','kingdom','civilization','battle','treaty','colonial','ancient','medieval',
        'timeline','dynasty','monarchy','republic','reform','migration','trade route','industrialization','renaissance','crusades',
        'constitution','independence','aristocracy','dictatorship','conquest','exploration','archeology','artifact','legacy','pharaoh',
        'ottoman','roman','greek','byzantine','feudalism','slavery','imperialism','cold war','ww1','ww2',
        'treaty of versailles','revolutionary war','french revolution','american revolution','cultural diffusion','silk road','mesopotamia','indus valley','viking','samurai',
        'colonization','migration pattern','historical evidence','chronology','manuscript','census'
      ],
    
      Geography: [
        'river','mountain','continent','climate','latitude','longitude','plate tectonics','desert','ocean',
        'forest','rainfall','weather','temperature','volcano','earthquake','glacier','island','archipelago','peninsula',
        'valley','plateau','delta','coastline','erosion','soil','ecosystem','habitat','wind patterns','monsoon',
        'tundra','savanna','tropics','equator','hemisphere','map','cartography','population density','urbanization','rural',
        'bay','strait','fjord','reef','wetlands','basin','altitude','longitude','meridian','time zone',
        'hydrology','biome','landform','climate change','global warming'
      ],
    
      Literature: [
        'poem','novel','protagonist','metaphor','narrative','theme','character','literary','plot','dialogue',
        'setting','tone','symbolism','allegory','irony','satire','genre','short story','stanza','rhyme',
        'verse','prose','critique','author','drama','tragedy','comedy','mythology','epic','fable',
        'imagery','motif','climax','resolution','conflict','foreshadowing','alliteration','personification','hyperbole','onomatopoeia',
        'biography','autobiography','memoir','novella','paradox','aphorism','manuscript','narrator','perspective','literary device',
        'denouement','excerpt','annotation','figurative language','moral','theme development'
      ],
    
      Language: [
        'grammar','syntax','vocabulary','phonetics','morphology','translation','pronunciation','semantics','linguistics','dialect',
        'accent','phonology','conjugation','sentence structure','verb','noun','adjective','adverb','preposition','article',
        'phrase','clause','punctuation','orthography','etymology','dictionary','idiom','slang','colloquialism','lexicon',
        'literal meaning','figurative meaning','context','native language','second language','bilingual','multilingual','speech','writing','reading',
        'listening','fluency','tone','register','formal language','informal language','grammar rules','plural','singular','prefix',
        'suffix','root word','translation accuracy','linguistic analysis','phonetic transcription'
      ],
    
      Art: [
        'painting','sculpture','canvas','gallery','artist','sketch','portrait','landscape','abstract','realism',
        'watercolor','oil paint','acrylic','charcoal','perspective','shading','composition','contrast','palette','mural',
        'exhibition','installation','modern art','renaissance','baroque','surrealism','impressionism','expressionism','pop art','digital art',
        'illustration','graphic design','color theory','contour','line art','texture','form','shape','proportion','symmetry',
        'aesthetics','calligraphy','visual art','drawing','design principles','art critique','collage','craft','concept art','mixed media'
      ],
    
      Music: [
        'melody','harmony','rhythm','composer','notation','scale','tempo','pitch','chord','song',
        'instrument','guitar','piano','violin','vocals','drums','orchestra','band','beat','bass',
        'treble','soprano','alto','tenor','baritone','measure','time signature','key signature','modulation','dynamics',
        'crescendo','decrescendo','symphony','opera','genre','tuning','interval','octave','solfege','metronome',
        'recording','mixing','mastering','audio','synthesis','sound wave','frequency','melodic line','riff','improvisation'
      ],
    
      Sports: [
        // General sports terminology
        'match','tournament','score','goal','player','athlete','stadium','coach','team','league',
        'referee','umpire','championship','training','workout','exercise','drill','competition','record','medal',
        'fitness','endurance','strength','strategy','playoff','season','defense','offense','foul','penalty',
        'tactics','teamwork','sportsmanship','warmup','stretching','injury','recovery','athletics','sprint','marathon',
        'ball','field','court','arena','victory','defeat','ranking','practice','fans','tournament bracket',
      
        // Actual sports (added)
        'football','soccer','basketball','cricket','tennis','badminton','table tennis','volleyball','baseball','softball',
        'hockey','ice hockey','rugby','golf','swimming','boxing','mma','wrestling','karate','taekwondo',
        'judo','archery','shooting','cycling','skating','skateboarding','surfing','rowing','kayaking','canoeing',
        'gymnastics','track','field events','long jump','high jump','pole vault','javelin','discus','shot put','triathlon','biathlon',
        'snowboarding','skiing','billiards','chess','esports','motorsport','formula 1','nascar','badminton doubles','boxing heavyweight'
      ],
      
    
      Entertainment: [
        'movie','film','actor','television','series','celebrity','director','producer','script','scene',
        'cinema','soundtrack','visual effects','comedy','drama','thriller','sci-fi','action','romance','animation',
        'documentary','trailer','premiere','box office','streaming','platform','binge watch','episode','cinematography','editing',
        'stunt','casting','hollywood','bollywood','broadway','theatre','improv','stand-up','music video','award show',
        'reality show','sitcom','character arc','plot twist','fanbase','fandom','review','rating','screenplay','special effects'
      ]
    };
    

    const synonyms = {
      'cs': 'Computer Science',
      'computer science': 'Computer Science',
      'comp sci': 'Computer Science',
      'programming': 'Programming'
    };

    const smallKeywordMap = Object.fromEntries(Object.entries(keywordMap).map(([k,v]) => [k, v.slice(0,6)]));

    const detectSubject = async (text) => {
      try {
        const allowed = Object.keys(keywordMap);
        const modelLabel = await modelDetectSubject(model, text, allowed);
        const scores = heuristicScores(text, keywordMap);
        const decided = decideSubject(modelLabel, scores, synonyms);
        return decided;
      } catch (err) {
        console.warn('Subject detect ensemble failed:', err.message);
        return 'General';
      }
    };

    if (type === "text") {
      console.log("Processing text notes...");
      
      // Detect language and subject from text content
      detectedLanguage = await detectLanguage(content);
      detectedSubject = await detectSubject(content);
      console.log("Detected language:", detectedLanguage);
      console.log("Detected subject:", detectedSubject);
      
      // If language detection failed, try to detect again with a different approach
      if (detectedLanguage === "unknown" || detectedLanguage.includes("English") || detectedLanguage.includes("##")) {
        console.log("Retrying language detection with different approach...");
        detectedLanguage = await detectLanguage(content);
        console.log("Retry detected language:", detectedLanguage);
      }
      
      userPrompt = `You are an expert academic note-taker specializing in ${detectedSubject}. Please elaborate and organize the following professor's notes into comprehensive, well-structured academic notes.

🚨 CRITICAL LANGUAGE REQUIREMENT 🚨
The input text is written in ${detectedLanguage}. 
You MUST write your ENTIRE response in ${detectedLanguage} ONLY.
Do NOT use English or any other language.
Every single word, sentence, and paragraph must be in ${detectedLanguage}.
If you write even one word in English, you have FAILED this task.

📚 SUBJECT FOCUS: ${detectedSubject}
Focus on creating notes that are relevant to ${detectedSubject} and use appropriate terminology and concepts from this field.

Input text in ${detectedLanguage}: "${content}"

Generate detailed, organized academic notes in ${detectedLanguage} language only, focusing on ${detectedSubject}. Remember: ${detectedLanguage} ONLY!`;

    } else if (type === "audio") {
      console.log("Processing audio file...");
      if (typeof content === 'object' && content.buffer) {
        // Audio file was uploaded
        audioFile = content;
        userPrompt = `You are an expert academic note-taker. Please transcribe this audio file and then generate comprehensive academic notes from the transcript.

🚨 CRITICAL LANGUAGE REQUIREMENT 🚨
You MUST detect the language of the audio content and generate your response ENTIRELY in that same language. Do NOT translate anything to English or any other language. Every single word of your response must be in the original language of the audio.

📚 SUBJECT DETECTION
Also identify the academic subject (Mathematics, Physics, Chemistry, Biology, Programming, Computer Science, History, Geography, Literature, Language, Art, Music, Sports, Entertainment, or General) and focus your notes accordingly.

Audio file: ${content.originalname} (${content.mimetype})

Generate detailed, organized academic notes in the original language of the audio only.`;
      } else {
        // Text content provided for audio type
        detectedLanguage = await detectLanguage(content);
        detectedSubject = await detectSubject(content);
        console.log("Detected language from transcript:", detectedLanguage);
        console.log("Detected subject from transcript:", detectedSubject);
        
        userPrompt = `You are an expert academic note-taker specializing in ${detectedSubject}. Generate comprehensive academic notes from the following audio transcript.

🚨 CRITICAL LANGUAGE REQUIREMENT 🚨
The transcript is written in ${detectedLanguage}. 
You MUST write your ENTIRE response in ${detectedLanguage} ONLY.
Do NOT use English or any other language.
Every single word, sentence, and paragraph must be in ${detectedLanguage}.
If you write even one word in English, you have FAILED this task.

📚 SUBJECT FOCUS: ${detectedSubject}
Focus on creating notes that are relevant to ${detectedSubject} and use appropriate terminology and concepts from this field.

Audio transcript in ${detectedLanguage}: "${content}"

Generate detailed, organized academic notes in ${detectedLanguage} language only, focusing on ${detectedSubject}. Remember: ${detectedLanguage} ONLY!`;
      }

    } else {
      return res.status(400).json({ error: 'Invalid input type. Must be "text" or "audio".' });
    }

    // Generate multi-language notes using the new system
    console.log('🔄 Starting multi-language note generation...');
    const multiLanguageResults = await generateMultiLanguageNotes(models.english, userPrompt, audioFile);
    
    console.log('✅ Multi-language notes generated successfully');
    console.log('📊 Processing time:', multiLanguageResults.processingTime, 'ms');

    // Use English notes for language detection and validation
    const generatedNotes = multiLanguageResults.english;

    // Post-generation re-check: try to improve subject detection using generated notes + original content
    try {
      detectedSubject = postDetectOverride(multiLanguageResults.english, content, smallKeywordMap, detectedSubject);
      console.log('Post-detection subject override result:', detectedSubject);
    } catch (e) {
      console.warn('Post-detect override failed:', e.message);
    }

    // Ensure we store the language as detected or default to English
    const targetLanguage = (detectedLanguage && detectedLanguage !== "unknown") ? detectedLanguage : 'English';
    detectedLanguage = targetLanguage;

    // Prepare data for saving to database (multi-language)
    const noteData = {
      input_type: type,
      generated_notes: {
        english: multiLanguageResults.english,
        hindi: multiLanguageResults.hindi,
        braille: multiLanguageResults.braille
      },
      detected_language: detectedLanguage,
      detected_subject: detectedSubject,
      original_content: typeof content === 'string' ? content : (content.originalname || 'audio_file'),
      original_language: detectedLanguage,
      model_used: GEMINI_MODEL,
      processing_time: multiLanguageResults.processingTime
    };

    // Ensure database connection
    const dbConnected = await ensureDBConnection();
    
    // Save notes to database (if connected)
    if (dbConnected) {
      try {
        const savedNote = await saveNotes(noteData);
        
        res.json({
          status: "success",
          input_type: type,
          model_used: GEMINI_MODEL,
          detected_language: detectedLanguage,
          detected_subject: detectedSubject,
          generated_notes: {
            english: multiLanguageResults.english,
            hindi: multiLanguageResults.hindi,
            braille: multiLanguageResults.braille
          },
          processing_time: multiLanguageResults.processingTime,
          note_id: savedNote._id,
          saved_at: savedNote.createdAt
        });
      } catch (dbError) {
        console.error("Database save error:", dbError);
        // Still return the generated notes even if database save fails
        res.json({
          status: "success",
          input_type: type,
          model_used: GEMINI_MODEL,
          detected_language: detectedLanguage,
          detected_subject: detectedSubject,
          generated_notes: {
            english: multiLanguageResults.english,
            hindi: multiLanguageResults.hindi,
            braille: multiLanguageResults.braille
          },
          processing_time: multiLanguageResults.processingTime,
          note_id: null,
          save_error: "Notes generated but failed to save to database"
        });
      }
    } else {
      // Database not connected, return notes without saving
      res.json({
        status: "success",
        input_type: type,
        model_used: GEMINI_MODEL,
        detected_language: detectedLanguage,
        detected_subject: detectedSubject,
        generated_notes: {
          english: multiLanguageResults.english,
          hindi: multiLanguageResults.hindi,
          braille: multiLanguageResults.braille
        },
        processing_time: multiLanguageResults.processingTime,
        note_id: null,
        database_status: "Database not connected - notes not saved"
      });
    }
  } catch (error) {
    console.error("Gemini API Error:", error);
    res.status(500).json({
      error: "Failed to generate notes from AI.",
      details: error.message,
    });
  }
});

// --- Notes Management Routes ---
app.use("/api/notes", async (req, res, next) => {
  const dbConnected = await ensureDBConnection();
  if (!dbConnected) {
    return res.status(503).json({
      status: "error",
      message: "Database not connected. Notes management unavailable."
    });
  }
  next();
}, notesRoutes);

// --- Start Server ---
const startServer = async () => {
  try {
    // Try to connect to database (optional for serverless)
    isDatabaseConnected = await connectDB();
    
    // Start the server
    app.listen(PORT, () => {
      console.log(`\n✅ AI Notes Maker Server running at http://localhost:${PORT}`);
      console.log(`Model in use: ${GEMINI_MODEL}`);
      console.log(`Database: ${isDatabaseConnected ? 'Connected' : 'Not connected'}`);
      console.log(`\nReady to receive POST requests at /generate-notes`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

// For Vercel serverless, export the app directly
if (process.env.NODE_ENV === 'production') {
  module.exports = app;
} else {
  // Start the application locally
  startServer();
}