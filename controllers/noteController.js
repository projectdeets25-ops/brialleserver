const Note = require('../models/Note');
const BrailleConverter = require('../utils/brailleConverter');

// Initialize Braille converter
const brailleConverter = new BrailleConverter();

// Save generated notes to database (multi-language support)
const saveNotes = async (noteData) => {
  try {
    const note = new Note({
      inputType: noteData.input_type,
      generatedNotes: {
        english: noteData.generated_notes.english,
        hindi: noteData.generated_notes.hindi,
        braille: noteData.generated_notes.braille
      },
      detectedLanguage: noteData.detected_language || 'unknown',
      detectedSubject: noteData.detected_subject || 'General',
      originalContent: noteData.original_content || '',
      processingMetadata: {
        originalLanguage: noteData.original_language || 'unknown',
        translationModel: noteData.model_used || 'gemini-2.5-flash-lite',
        brailleGrade: 'Grade2',
        processingTime: noteData.processing_time || 0
      }
    });

    const savedNote = await note.save();
    console.log('✅ Multi-language notes saved to database:', savedNote._id);
    return savedNote;
  } catch (error) {
    console.error('❌ Error saving multi-language notes to database:', error.message);
    throw error;
  }
};

// Generate notes in multiple languages
const generateMultiLanguageNotes = async (model, userPrompt, audioFile = null) => {
  const startTime = Date.now();
  const results = {};

  try {
    // Generate English notes
    console.log('🔄 Generating English notes...');
    const englishResult = await generateSingleLanguageNotes(model, userPrompt, 'english', audioFile);
    results.english = englishResult;

    // Generate Hindi notes
    console.log('🔄 Generating Hindi notes...');
    const hindiPrompt = `Translate the following English academic notes to Hindi while maintaining the same structure, formatting, and academic quality. Keep all technical terms accurate and use appropriate Hindi academic vocabulary:

${englishResult}

Generate the complete notes in Hindi with the same structure (Title, Introduction, Headings, Lists, Key Definitions).`;
    
    const hindiResult = await generateSingleLanguageNotes(model, hindiPrompt, 'hindi');
    results.hindi = hindiResult;

    // Generate Braille notes (convert English to Braille)
    console.log('🔄 Converting English notes to Braille...');
    const brailleResult = brailleConverter.convertAcademicNotes(englishResult);
    results.braille = brailleResult;

    // Validate Braille conversion
    if (!brailleConverter.isValidBraille(brailleResult)) {
      console.warn('⚠️ Braille conversion may have issues, using fallback...');
      results.braille = brailleConverter.textToBraille(englishResult, true);
    }

    const processingTime = Date.now() - startTime;
    console.log(`✅ Multi-language generation completed in ${processingTime}ms`);

    return {
      ...results,
      processingTime
    };

  } catch (error) {
    console.error('❌ Error in multi-language generation:', error.message);
    throw error;
  }
};

// Generate notes in a single language
const generateSingleLanguageNotes = async (model, prompt, language = 'english', audioFile = null) => {
  try {
    let result;
    
    if (audioFile) {
      // Include audio file in the request
      result = await model.generateContent({
        contents: [{ 
          role: "user", 
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: audioFile.mimetype,
                data: audioFile.buffer.toString('base64')
              }
            }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.8,
          maxOutputTokens: 2048,
        },
      });
    } else {
      // Text-only request
      result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.8,
          maxOutputTokens: 2048,
        },
      });
    }

    return result.response.text();
  } catch (error) {
    console.error(`❌ Error generating ${language} notes:`, error.message);
    throw error;
  }
};


// Get all notes with comprehensive filtering (search, date filter, pagination)
const getAllNotes = async (req, res) => {
  try {
    // Extract query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Build query object
    let query = {};
    let appliedFilters = {};
    
    // Date filtering
    if (req.query.startDate || req.query.endDate) {
      query.createdAt = {};
      if (req.query.startDate) {
        query.createdAt.$gte = new Date(req.query.startDate);
        appliedFilters.startDate = req.query.startDate;
      }
      if (req.query.endDate) {
        query.createdAt.$lte = new Date(req.query.endDate);
        appliedFilters.endDate = req.query.endDate;
      }
    }
    
    // Search functionality (supports both 'search' and 'q' parameters)
    const searchTerm = req.query.search || req.query.q;
    if (searchTerm) {
      query.$or = [
        { 'generatedNotes.english': { $regex: searchTerm, $options: 'i' } },
        { 'generatedNotes.hindi': { $regex: searchTerm, $options: 'i' } },
        { 'generatedNotes.braille': { $regex: searchTerm, $options: 'i' } },
        { inputType: { $regex: searchTerm, $options: 'i' } },
        { detectedLanguage: { $regex: searchTerm, $options: 'i' } },
        { detectedSubject: { $regex: searchTerm, $options: 'i' } },
        { originalContent: { $regex: searchTerm, $options: 'i' } }
      ];
      appliedFilters.search = searchTerm;
    }
    
    // Input type filtering
    if (req.query.inputType) {
      query.inputType = req.query.inputType;
      appliedFilters.inputType = req.query.inputType;
    }
    
    // Language filtering
    if (req.query.language) {
      query.detectedLanguage = { $regex: req.query.language, $options: 'i' };
      appliedFilters.language = req.query.language;
    }
    
    // Subject filtering
    if (req.query.subject) {
      query.detectedSubject = { $regex: req.query.subject, $options: 'i' };
      appliedFilters.subject = req.query.subject;
    }
    
    // Sort order (default: newest first)
    const sortOrder = req.query.sort === 'asc' ? 1 : -1;
    const sortField = req.query.sortBy || 'createdAt';
    
    // Get total count for pagination
    const totalCount = await Note.countDocuments(query);
    
    // Get notes with pagination
    const notes = await Note.find(query)
      .sort({ [sortField]: sortOrder })
      .skip(skip)
      .limit(limit)
      .select('inputType generatedNotes detectedLanguage detectedSubject originalContent processingMetadata createdAt updatedAt');
    
    const totalPages = Math.ceil(totalCount / limit);
    
    res.json({
      status: 'success',
      appliedFilters: appliedFilters,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalCount: totalCount,
        limit: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      },
      notes: notes
    });
  } catch (error) {
    console.error('❌ Error fetching notes:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch notes',
      error: error.message
    });
  }
};

// Get a specific note by ID
const getNoteById = async (req, res) => {
  try {
    const note = await Note.findById(req.params.id);
    if (!note) {
      return res.status(404).json({
        status: 'error',
        message: 'Note not found'
      });
    }
    res.json({
      status: 'success',
      note: note
    });
  } catch (error) {
    console.error('❌ Error fetching note:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch note',
      error: error.message
    });
  }
};

// Update a note by ID (all fields except inputType)
const updateNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { generatedNotes, detectedLanguage, detectedSubject, originalContent } = req.body;

    // Validate required fields - now expecting multi-language structure
    if (!generatedNotes || (!generatedNotes.english && !generatedNotes.hindi && !generatedNotes.braille)) {
      return res.status(400).json({
        status: 'error',
        message: 'generatedNotes with at least one language (english, hindi, or braille) is required'
      });
    }

    // Prepare update object (exclude inputType)
    const updateData = {
      updatedAt: new Date()
    };

    // Update generatedNotes if provided
    if (generatedNotes) {
      updateData.generatedNotes = {};
      if (generatedNotes.english !== undefined) {
        updateData['generatedNotes.english'] = generatedNotes.english;
      }
      if (generatedNotes.hindi !== undefined) {
        updateData['generatedNotes.hindi'] = generatedNotes.hindi;
      }
      if (generatedNotes.braille !== undefined) {
        updateData['generatedNotes.braille'] = generatedNotes.braille;
      }
    }

    // Add optional fields if provided
    if (detectedLanguage !== undefined) {
      updateData.detectedLanguage = detectedLanguage;
    }
    if (detectedSubject !== undefined) {
      updateData.detectedSubject = detectedSubject;
    }
    if (originalContent !== undefined) {
      updateData.originalContent = originalContent;
    }

    // Find and update the note
    const updatedNote = await Note.findByIdAndUpdate(
      id,
      updateData,
      { 
        new: true, // Return the updated document
        runValidators: true // Run schema validators
      }
    );

    if (!updatedNote) {
      return res.status(404).json({
        status: 'error',
        message: 'Note not found'
      });
    }

    console.log('✅ Note updated successfully:', updatedNote._id);
    res.json({
      status: 'success',
      message: 'Note updated successfully',
      note: updatedNote
    });
  } catch (error) {
    console.error('❌ Error updating note:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update note',
      error: error.message
    });
  }
};

// Delete a note by ID
const deleteNote = async (req, res) => {
  try {
    const note = await Note.findByIdAndDelete(req.params.id);
    if (!note) {
      return res.status(404).json({
        status: 'error',
        message: 'Note not found'
      });
    }
    res.json({
      status: 'success',
      message: 'Note deleted successfully',
      deletedNote: note
    });
  } catch (error) {
    console.error('❌ Error deleting note:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete note',
      error: error.message
    });
  }
};

module.exports = {
  saveNotes,
  generateMultiLanguageNotes,
  generateSingleLanguageNotes,
  getAllNotes,
  getNoteById,
  updateNote,
  deleteNote
};
