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

    // Function to detect subject from text content
    // Strategy: 1) Rule-based keyword matching for determinism and speed.
    //           2) If rules are inconclusive, use a stricter model prompt with normalization.
    const detectSubject = async (text) => {
      try {
        // Quick guard: empty or very short text
        if (!text || text.trim().length < 20) {
          return "General";
        }

        // Rule-based keyword maps (ordered, each with a set of regexes)
        const subjectKeywords = [
          {
            name: 'Mathematics',
            patterns: [
              /\b(math|mathematics|arithmetic|number theory|set theory|logic|discrete math)\b/i,
              /\b(algebra|linear algebra|abstract algebra|group theory|ring theory|field theory|vector space)\b/i,
              /\b(calculus|differentiation|integration|derivative|integral|limit|series|sequence|multivariable)\b/i,
              /\b(geometry|euclidean|non-euclidean|analytic geometry|coordinate geometry|trigonometry|sin|cos|tan|radian|angle)\b/i,
              /\b(matrix|vector|tensor|eigenvalue|eigenvector|determinant|rank|inverse)\b/i,
              /\b(differential equation|ODE|PDE|fourier|laplace transform|heat equation|wave equation)\b/i,
              /\b(probability|statistics|random|distribution|normal distribution|mean|median|mode|variance|std dev|bayesian)\b/i,
              /\b(combinatorics|permutation|combination|graph theory|network|optimization)\b/i
            ]
          },
        
          {
            name: 'Physics',
            patterns: [
              /\b(physics|physical science|mechanics|dynamics|kinematics)\b/i,
              /\b(force|velocity|acceleration|momentum|energy|power|work|mass|torque|inertia|friction)\b/i,
              /\b(gravity|newton|laws of motion|projectile|collision|center of mass)\b/i,
              /\b(wave|oscillation|frequency|amplitude|interference|diffraction|resonance)\b/i,
              /\b(light|optics|reflection|refraction|lens|mirror|optical)\b/i,
              /\b(thermodynamics|heat|temperature|entropy|enthalpy|pressure|gas law)\b/i,
              /\b(electric|magnetic|electromagnetic|charge|current|voltage|resistance|circuit|capacitance|inductance)\b/i,
              /\b(quantum|electron|photon|proton|neutron|quark|spin|wavefunction)\b/i,
              /\b(relativity|einstein|spacetime|special relativity|general relativity|speed of light)\b/i,
              /\b(nuclear|radioactive|radiation|fusion|fission|decay)\b/i
            ]
          },
        
          {
            name: 'Chemistry',
            patterns: [
              /\b(chemistry|chemical|chemist|analytical|physical chemistry)\b/i,
              /\b(atom|element|ion|molecule|compound|mixture|solution)\b/i,
              /\b(bond|ionic|covalent|metallic|polar|nonpolar|valence)\b/i,
              /\b(organic|inorganic|biochemistry|functional group|alkane|alkene|alkyne|aromatic)\b/i,
              /\b(acid|base|pH|titration|buffer|solubility)\b/i,
              /\b(reaction|reactant|product|equilibrium|catalyst|rate|stoichiometry|oxidation|reduction|redox)\b/i,
              /\b(chromatography|spectroscopy|IR|NMR|mass spectrometry)\b/i,
              /\b(periodic table|electron configuration|orbital|quantum number)\b/i
            ]
          },
        
          {
            name: 'Biology',
            patterns: [
              /\b(biology|life science|biological)\b/i,
              /\b(cell|organelle|nucleus|mitochondria|ribosome|membrane)\b/i,
              /\b(DNA|RNA|chromosome|genome|gene|allele|genetics|heredity)\b/i,
              /\b(evolution|natural selection|adaptation|variation|speciation)\b/i,
              /\b(photosynthesis|cellular respiration|ATP|chloroplast)\b/i,
              /\b(protein|enzyme|amino acid|lipid|carbohydrate|metabolism)\b/i,
              /\b(mitosis|meiosis|cell cycle|replication|transcription|translation)\b/i,
              /\b(anatomy|physiology|organ|tissue|circulatory|respiratory|nervous)\b/i,
              /\b(ecology|ecosystem|population|community|biosphere)\b/i,
              /\b(microbiology|bacteria|virus|fungi|protist)\b/i
            ]
          },
        
          {
            name: 'Computer Science',
            patterns: [
              /\b(computer science|cs|computation|informatics|IT)\b/i,
              /\b(algorithm|data structure|graph|tree|heap|stack|queue|hash)\b/i,
              /\b(binary|bit|byte|machine code|instruction|assembly)\b/i,
              /\b(compiler|interpreter|runtime|virtual machine)\b/i,
              /\b(complexity|big o|time complexity|space complexity)\b/i,
              /\b(database|SQL|NoSQL|index|query|transaction|ACID)\b/i,
              /\b(network|TCP|HTTP|UDP|protocol|IP|socket)\b/i,
              /\b(machine learning|AI|neural network|deep learning|model|training|dataset)\b/i,
              /\b(operating system|OS|kernel|process|thread|memory management)\b/i,
              /\b(distributed system|microservice|cloud computing|virtualization)\b/i
            ]
          },
        
          {
            name: 'Programming',
            patterns: [
              /\b(programming|coding|software development|script|scripting)\b/i,
              /\b(function|method|variable|const|let|loop|for|while|if|else|switch)\b/i,
              /\b(array|list|dictionary|map|stack|queue|pointer|reference)\b/i,
              /\b(java|python|javascript|typescript|c\+\+|c#|go|golang|rust|php|ruby|swift|kotlin)\b/i,
              /\b(api|rest|graphql|fetch|axios|http request|endpoint)\b/i,
              /\b(oop|object oriented|class|inheritance|polymorphism)\b/i,
              /\b(recursion|iteration|lambda|closure|callback|async|await|promise)\b/i,
              /\b(compilation|debug|runtime|exception|stack trace)\b/i,
            ]
          },
        
          {
            name: 'History',
            patterns: [
              /\b(history|historical|historiography)\b/i,
              /\b(ancient|medieval|renaissance|modern era|industrial revolution)\b/i,
              /\b(empire|civilization|dynasty|kingdom|republic)\b/i,
              /\b(war|battle|revolution|treaty|conflict|rebellion)\b/i,
              /\b(colonial|imperial|independence|nationalism)\b/i,
              /\b(roman|greek|ottoman|byzantine|british empire)\b/i
            ]
          },
        
          {
            name: 'Geography',
            patterns: [
              /\b(geography|geographic|geology|earth science)\b/i,
              /\b(continent|country|region|territory|capital)\b/i,
              /\b(latitude|longitude|equator|hemisphere|tropic|meridian)\b/i,
              /\b(mountain|volcano|river|lake|ocean|desert|forest|plateau)\b/i,
              /\b(climate|weather|temperature|precipitation|biome)\b/i,
              /\b(plate tectonics|earthquake|tsunami)\b/i
            ]
          },
        
          {
            name: 'Literature',
            patterns: [
              /\b(literature|literary|literary analysis|classic)\b/i,
              /\b(poem|poetry|sonnet|stanza|rhyme|meter)\b/i,
              /\b(novel|novella|short story|prose|drama|play|tragedy|comedy)\b/i,
              /\b(character|protagonist|antagonist|plot|theme|motif|symbolism|narrative)\b/i,
              /\b(author|writer|poet|essay)\b/i
            ]
          },
        
          {
            name: 'Language',
            patterns: [
              /\b(language|linguistics|linguistic|philology)\b/i,
              /\b(grammar|syntax|semantics|phonetics|phonology|morphology|pragmatics)\b/i,
              /\b(vocabulary|lexicon|word root|etymology)\b/i,
              /\b(translation|interpretation|bilingual|multilingual)\b/i
            ]
          },
        
          {
            name: 'Art',
            patterns: [
              /\b(art|visual art|fine arts|artistic)\b/i,
              /\b(painting|sculpture|drawing|sketch|illustration)\b/i,
              /\b(canvas|palette|brush|oil paint|acrylic|watercolor)\b/i,
              /\b(gallery|museum|exhibition|curator|installation)\b/i,
              /\b(composition|perspective|color theory|contrast|symmetry)\b/i
            ]
          },
        
          {
            name: 'Music',
            patterns: [
              /\b(music|musical|music theory)\b/i,
              /\b(melody|harmony|rhythm|tempo|beat|pitch|scale|interval|chord)\b/i,
              /\b(composer|songwriter|performer|instrumentalist)\b/i,
              /\b(song|track|album|orchestra|band|choir|ensemble)\b/i,
              /\b(piano|guitar|violin|drums|saxophone|vocal)\b/i
            ]
          },
        
          {
            name: 'Sports',
            patterns: [
              /\b(sport|athletics|athlete|competitive)\b/i,
              /\b(match|game|tournament|league|championship)\b/i,
              /\b(score|goal|point|win|lose|draw)\b/i,
              /\b(team|coach|referee|umpire|player)\b/i,
              /\b(football|soccer|basketball|cricket|baseball|tennis|golf|volleyball|swimming|running)\b/i,
            ]
          },
        
          {
            name: 'Entertainment',
            patterns: [
              /\b(entertainment|media|pop culture|showbiz)\b/i,
              /\b(movie|film|cinema|blockbuster|trailer)\b/i,
              /\b(actor|actress|director|producer|celebrity|influencer)\b/i,
              /\b(tv|television|series|episode|sitcom|drama|reality show)\b/i,
              /\b(music video|award show|performance)\b/i
            ]
          }
        ];
        

        const matchCounts = {};
        for (const s of subjectKeywords) {
          for (const p of s.patterns) {
            if (p.test(text)) {
              matchCounts[s.name] = (matchCounts[s.name] || 0) + 1;
            }
          }
        }

        const matchedSubjects = Object.keys(matchCounts).sort((a, b) => matchCounts[b] - matchCounts[a]);
        // If a single clear match exists, return it
        if (matchedSubjects.length === 1) {
          return matchedSubjects[0];
        }
        // If top match is significantly stronger than second, choose it
        if (matchedSubjects.length > 1) {
          const top = matchedSubjects[0];
          const second = matchedSubjects[1];
          if (matchCounts[top] >= (matchCounts[second] * 1.5) && matchCounts[top] >= 1) {
            return top;
          }
        }

        // If rules were inconclusive, fall back to model with a strict, few-shot prompt
        const allowed = ["Mathematics","Physics","Chemistry","Biology","Programming","Computer Science","History","Geography","Literature","Language","Art","Music","Sports","Entertainment","General"];
        const examples = [
          { text: "The derivative of sin x is cos x and we study limits and continuity.", label: "Mathematics" },
          { text: "The heart pumps blood through the circulatory system and arteries.", label: "Biology" },
          { text: "Designing RESTful APIs involves endpoints, HTTP verbs, and status codes.", label: "Computer Science" },
          { text: "The Treaty of Versailles ended the First World War in 1919.", label: "History" }
        ];

        let exampleStr = "";
        for (const ex of examples) {
          exampleStr += `Text: "${ex.text}" -> ${ex.label}\n`;
        }

        const prompt = `You are an objective classifier. Respond with EXACTLY one of: ${allowed.join(", ")}. Examples:\n${exampleStr}\nNow analyze the text below and respond with ONLY the subject name (one of the allowed list), no explanation, no punctuation:\n\n"${text.substring(0, 1000)}"`;

        const subjectResult = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.0,
            maxOutputTokens: 8,
          },
        });

        const detectedSubjRaw = subjectResult.response.text().trim();
        const cleanSubj = detectedSubjRaw.split('\n')[0].split('.')[0].trim();
        console.log("Raw subject detection (model):", detectedSubjRaw);
        console.log("Cleaned subject (model):", cleanSubj);

        // Normalize model output to the allowed labels
        for (const a of allowed) {
          if (cleanSubj.toLowerCase() === a.toLowerCase()) return a;
        }
        // Map common variants
        const variantMap = {
          'cs': 'Computer Science',
          'computer science': 'Computer Science',
          'comp sci': 'Computer Science',
          'programming': 'Programming'
        };
        const lc = cleanSubj.toLowerCase();
        for (const k in variantMap) {
          if (lc.includes(k)) return variantMap[k];
        }

        // If still unrecognized, default to General
        return "General";
      } catch (error) {
        console.warn("Subject detection failed:", error.message);
        return "General";
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