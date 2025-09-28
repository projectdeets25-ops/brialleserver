const Note = require('../models/Note');

// Save generated notes to database
const saveNotes = async (noteData) => {
  try {
    const note = new Note({
      inputType: noteData.input_type,
      generatedNotes: noteData.generated_notes
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
        { inputType: { $regex: searchTerm, $options: 'i' } }
      ];
      appliedFilters.search = searchTerm;
    }
    
    // Input type filtering
    if (req.query.inputType) {
      query.inputType = req.query.inputType;
      appliedFilters.inputType = req.query.inputType;
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
      .select('inputType generatedNotes createdAt updatedAt');
    
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
  deleteNote
};
