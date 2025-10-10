const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  inputType: {
    type: String,
    required: true,
    enum: ['text', 'audio']
  },
  // Multi-language support: store notes in three languages
  generatedNotes: {
    english: {
      type: String,
      required: true
    },
    hindi: {
      type: String,
      required: true
    },
    braille: {
      type: String,
      required: true
    }
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
  // Metadata for multi-language processing
  processingMetadata: {
    originalLanguage: {
      type: String,
      default: 'unknown'
    },
    translationModel: {
      type: String,
      default: 'gemini-2.5-flash-lite'
    },
    brailleGrade: {
      type: String,
      default: 'Grade2',
      enum: ['Grade1', 'Grade2']
    },
    processingTime: {
      type: Number, // milliseconds
      default: 0
    }
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
