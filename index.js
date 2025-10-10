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
    const detectSubject = async (text) => {
      try {
        const subjectResult = await model.generateContent({
          contents: [{ 
            role: "user", 
            parts: [{ 
              text: `Analyze this text and identify the academic subject it belongs to. Respond with ONLY one of these subjects: "Mathematics", "Physics", "Chemistry", "Biology", "Programming", "Computer Science", "History", "Geography", "Literature", "Language", "Art", "Music", "Sports", "Entertainment", "General". Do not include any other text or explanation:

"${text.substring(0, 500)}"` 
            }] 
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 20,
          },
        });
        const detectedSubj = subjectResult.response.text().trim();
        // Clean up any extra text that might come with the response
        const cleanSubj = detectedSubj.split('\n')[0].split('.')[0].trim();
        console.log("Raw subject detection:", detectedSubj);
        console.log("Cleaned subject:", cleanSubj);
        return cleanSubj;
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