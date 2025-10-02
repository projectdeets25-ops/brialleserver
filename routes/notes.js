const express = require('express');
const router = express.Router();
const { 
  getAllNotes, 
  getNoteById, 
  updateNote,
  deleteNote
} = require('../controllers/noteController');

// Get all notes with comprehensive filtering (search, date filter, pagination)
router.get('/', getAllNotes);

// Get a specific note by ID
router.get('/:id', getNoteById);

// Update a note by ID (all fields except inputType)
router.put('/:id', updateNote);

// Delete a note by ID
router.delete('/:id', deleteNote);

module.exports = router;
