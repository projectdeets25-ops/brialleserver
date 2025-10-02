const Note = require('../models/Note');

// Save generated notes to database
const saveNotes = async (noteData) => {
  try {
    const note = new Note({
      inputType: noteData.input_type,
      generatedNotes: noteData.generated_notes,
      detectedLanguage: noteData.detected_language || 'unknown',
      detectedSubject: noteData.detected_subject || 'General',
      originalContent: noteData.original_content || ''
    });

    const savedNote = await note.save();
    console.log('✅ Notes saved to database:', savedNote._id);
    return savedNote;
  } catch (error) {
    console.error('❌ Error saving notes to database:', error.message);
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
        { generatedNotes: { $regex: searchTerm, $options: 'i' } },
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
      .select('inputType generatedNotes detectedLanguage detectedSubject originalContent createdAt updatedAt');
    
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

    // Validate required fields
    if (!generatedNotes) {
      return res.status(400).json({
        status: 'error',
        message: 'generatedNotes is required'
      });
    }

    // Prepare update object (exclude inputType)
    const updateData = {
      generatedNotes,
      updatedAt: new Date()
    };

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
  getAllNotes,
  getNoteById,
  updateNote,
  deleteNote
};
