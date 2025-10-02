const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  inputType: {
    type: String,
    required: true,
    enum: ['text', 'audio']
  },
  generatedNotes: {
    type: String,
    required: true
  },
  detectedLanguage: {
    type: String,
    default: 'unknown'
  },
  detectedSubject: {
    type: String,
    default: 'General'
  },
  originalContent: {
    type: String,
    default: ''
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
noteSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Note', noteSchema);
