// Braille Converter Utility - UEB Grade 2 Support
// Converts English text to Unicode Braille Patterns (U+2800..U+28FF)

class BrailleConverter {
  constructor() {
    // Unicode Braille base character (⠀)
    this.BRAILLE_BASE = 0x2800;
    
    // UEB Grade 2 alphabet mapping (a-z)
    this.ALPHABET_MAP = {
      'a': '⠁', 'b': '⠃', 'c': '⠉', 'd': '⠙', 'e': '⠑', 'f': '⠋',
      'g': '⠛', 'h': '⠓', 'i': '⠊', 'j': '⠚', 'k': '⠅', 'l': '⠇',
      'm': '⠍', 'n': '⠝', 'o': '⠕', 'p': '⠏', 'q': '⠟', 'r': '⠗',
      's': '⠎', 't': '⠞', 'u': '⠥', 'v': '⠧', 'w': '⠺', 'x': '⠭',
      'y': '⠽', 'z': '⠵'
    };

    // Numbers (with number prefix ⠼)
    this.NUMBER_MAP = {
      '0': '⠚', '1': '⠁', '2': '⠃', '3': '⠉', '4': '⠙', '5': '⠑',
      '6': '⠋', '7': '⠛', '8': '⠓', '9': '⠊'
    };

    // UEB Grade 2 contractions (common words)
    this.CONTRACTIONS = {
      'and': '⠯', 'for': '⠿', 'of': '⠷', 'the': '⠮', 'with': '⠾',
      'you': '⠽', 'as': '⠵', 'but': '⠃', 'can': '⠉', 'do': '⠙',
      'every': '⠑', 'from': '⠋', 'go': '⠛', 'have': '⠓', 'just': '⠚',
      'knowledge': '⠅', 'like': '⠇', 'more': '⠍', 'not': '⠝', 'people': '⠏',
      'quite': '⠟', 'rather': '⠗', 'so': '⠎', 'that': '⠞', 'us': '⠥',
      'very': '⠧', 'will': '⠺', 'it': '⠭', 'his': '⠓', 'was': '⠺',
      'were': '⠺', 'are': '⠜', 'be': '⠆', 'been': '⠆', 'had': '⠓',
      'have': '⠓', 'here': '⠓', 'know': '⠅', 'lord': '⠇', 'may': '⠍',
      'name': '⠝', 'one': '⠕', 'part': '⠏', 'question': '⠟', 'right': '⠗',
      'some': '⠎', 'time': '⠞', 'under': '⠥', 'work': '⠺', 'young': '⠽'
    };

    // Punctuation marks
    this.PUNCTUATION_MAP = {
      '.': '⠲', ',': '⠂', ';': '⠆', ':': '⠒', '!': '⠖', '?': '⠦',
      '"': '⠦', "'": '⠄', '(': '⠐⠣', ')': '⠐⠜', '[': '⠨⠣', ']': '⠨⠜',
      '{': '⠸⠣', '}': '⠸⠜', '-': '⠤', '–': '⠠⠤', '—': '⠐⠠⠤',
      '/': '⠸⠌', '\\': '⠸⠡', '*': '⠐⠔', '&': '⠈⠯', '@': '⠈⠁',
      '#': '⠼', '$': '⠈⠎', '%': '⠨⠴', '^': '⠘⠔', '~': '⠘⠱',
      '`': '⠘⠄', '|': '⠸⠳', '<': '⠈⠣', '>': '⠈⠜', '=': '⠐⠶',
      '+': '⠐⠖', '_': '⠸⠤'
    };

    // Special indicators
    this.INDICATORS = {
      CAPITAL: '⠠',      // Capital letter indicator
      NUMBER: '⠼',       // Number indicator
      ITALIC: '⠨',       // Italic indicator
      BOLD: '⠸',         // Bold indicator
      UNDERLINE: '⠘',    // Underline indicator
      EMPHASIS: '⠌',     // Emphasis indicator
      NEWLINE: '\n',     // Line break
      SPACE: ' '         // Space
    };

    // Grade 2 contractions for common letter combinations
    this.LETTER_CONTRACTIONS = {
      'ch': '⠡', 'gh': '⠣', 'sh': '⠩', 'th': '⠹', 'wh': '⠱', 'ed': '⠫',
      'er': '⠻', 'ou': '⠳', 'ow': '⠪', 'st': '⠌', 'ar': '⠜', 'ing': '⠬'
    };
  }

  /**
   * Convert English text to UEB Grade 2 Braille
   * @param {string} text - Input text to convert
   * @param {boolean} useGrade2 - Whether to use Grade 2 contractions (default: true)gggg
   * @returns {string} - Braille text using Unicode Braille Patterns
   */
  textToBraille(text, useGrade2 = true) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    let result = '';
    let i = 0;
    let inNumber = false;

    // Process text character by character
    while (i < text.length) {
      const char = text[i];
      const lowerChar = char.toLowerCase();
      
      // Handle whitespace
      if (/\s/.test(char)) {
        result += this.INDICATORS.SPACE;
        inNumber = false;
        i++;
        continue;
      }

      // Handle newlines
      if (char === '\n') {
        result += this.INDICATORS.NEWLINE;
        inNumber = false;
        i++;
        continue;
      }

      // Handle numbers
      if (/\d/.test(char)) {
        if (!inNumber) {
          result += this.INDICATORS.NUMBER;
          inNumber = true;
        }
        result += this.NUMBER_MAP[char] || char;
        i++;
        continue;
      } else {
        inNumber = false;
      }

      // Handle punctuation
      if (this.PUNCTUATION_MAP[char]) {
        result += this.PUNCTUATION_MAP[char];
        i++;
        continue;
      }

      // Handle letters
      if (/[a-zA-Z]/.test(char)) {
        // Check for capital letters
        if (/[A-Z]/.test(char)) {
          result += this.INDICATORS.CAPITAL;
        }

        // Try Grade 2 contractions if enabled
        if (useGrade2) {
          let foundContraction = false;

          // Check for whole word contractions
          const wordMatch = this.findWordContraction(text, i);
          if (wordMatch) {
            result += wordMatch.braille;
            i += wordMatch.length;
            foundContraction = true;
          }

          // Check for letter combination contractions
          if (!foundContraction) {
            const letterMatch = this.findLetterContraction(text, i);
            if (letterMatch) {
              result += letterMatch.braille;
              i += letterMatch.length;
              foundContraction = true;
            }
          }

          // If no contraction found, use regular letter
          if (!foundContraction) {
            result += this.ALPHABET_MAP[lowerChar] || char;
            i++;
          }
        } else {
          // Grade 1: just convert letter
          result += this.ALPHABET_MAP[lowerChar] || char;
          i++;
        }
      } else {
        // Unknown character, keep as is
        result += char;
        i++;
      }
    }

    return result;
  }

  /**
   * Find word contractions at current position
   * @param {string} text - Full text
   * @param {number} pos - Current position
   * @returns {object|null} - Contraction match or null
   */
  findWordContraction(text, pos) {
    // Check if we're at word boundary
    if (pos > 0 && /[a-zA-Z]/.test(text[pos - 1])) {
      return null;
    }

    // Try to match contractions (longest first)
    const sortedContractions = Object.keys(this.CONTRACTIONS)
      .sort((a, b) => b.length - a.length);

    for (const word of sortedContractions) {
      const endPos = pos + word.length;
      if (endPos <= text.length) {
        const textSlice = text.slice(pos, endPos).toLowerCase();
        if (textSlice === word) {
          // Check word boundary at end
          if (endPos === text.length || !/[a-zA-Z]/.test(text[endPos])) {
            return {
              braille: this.CONTRACTIONS[word],
              length: word.length
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Find letter combination contractions at current position
   * @param {string} text - Full text
   * @param {number} pos - Current position
   * @returns {object|null} - Contraction match or null
   */
  findLetterContraction(text, pos) {
    // Try to match letter contractions (longest first)
    const sortedContractions = Object.keys(this.LETTER_CONTRACTIONS)
      .sort((a, b) => b.length - a.length);

    for (const letters of sortedContractions) {
      const endPos = pos + letters.length;
      if (endPos <= text.length) {
        const textSlice = text.slice(pos, endPos).toLowerCase();
        if (textSlice === letters) {
          return {
            braille: this.LETTER_CONTRACTIONS[letters],
            length: letters.length
          };
        }
      }
    }

    return null;
  }

  /**
   * Convert structured academic notes to Braille with formatting
   * @param {string} notes - Academic notes with markdown-like formatting
   * @returns {string} - Formatted Braille notes
   */
  convertAcademicNotes(notes) {
    if (!notes || typeof notes !== 'string') {
      return '';
    }

    let result = '';
    const lines = notes.split('\n');

    for (let line of lines) {
      line = line.trim();
      
      if (!line) {
        result += '\n';
        continue;
      }

      // Handle titles (# Title)
      if (line.startsWith('# ')) {
        const title = line.substring(2);
        result += this.INDICATORS.CAPITAL + this.textToBraille(title.toUpperCase()) + '\n\n';
        continue;
      }

      // Handle headings (## Heading)
      if (line.startsWith('## ')) {
        const heading = line.substring(3);
        result += this.INDICATORS.BOLD + this.textToBraille(heading) + '\n\n';
        continue;
      }

      // Handle bullet points (* item or - item)
      if (line.startsWith('* ') || line.startsWith('- ')) {
        const item = line.substring(2);
        result += '⠸⠲ ' + this.textToBraille(item) + '\n';
        continue;
      }

      // Handle numbered lists (1. item)
      if (/^\d+\.\s/.test(line)) {
        const match = line.match(/^(\d+)\.\s(.+)$/);
        if (match) {
          const number = match[1];
          const item = match[2];
          result += this.INDICATORS.NUMBER + this.textToBraille(number) + '⠲ ' + this.textToBraille(item) + '\n';
          continue;
        }
      }

      // Handle bold text (**text**)
      line = line.replace(/\*\*(.*?)\*\*/g, (match, text) => {
        return this.INDICATORS.BOLD + this.textToBraille(text) + this.INDICATORS.BOLD;
      });

      // Handle italic text (*text*)
      line = line.replace(/\*(.*?)\*/g, (match, text) => {
        return this.INDICATORS.ITALIC + this.textToBraille(text) + this.INDICATORS.ITALIC;
      });

      // Convert regular line
      result += this.textToBraille(line) + '\n';
    }

    return result.trim();
  }

  /**
   * Validate if text contains only Unicode Braille characters
   * @param {string} text - Text to validate
   * @returns {boolean} - True if text is valid Braille
   */
  isValidBraille(text) {
    if (!text || typeof text !== 'string') {
      return false;
    }

    // Allow Braille characters (U+2800-U+28FF), spaces, and newlines
    const brailleRegex = /^[\u2800-\u28FF\s\n]*$/;
    return brailleRegex.test(text);
  }

  /**
   * Get Braille character info for debugging
   * @param {string} char - Single Braille character
   * @returns {object} - Character information
   */
  getBrailleCharInfo(char) {
    if (!char || char.length !== 1) {
      return null;
    }

    const codePoint = char.codePointAt(0);
    if (codePoint >= 0x2800 && codePoint <= 0x28FF) {
      const dots = codePoint - 0x2800;
      return {
        character: char,
        unicode: `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`,
        dots: dots,
        binary: dots.toString(2).padStart(8, '0')
      };
    }

    return null;
  }
}

module.exports = BrailleConverter;
