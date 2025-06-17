import { Injectable } from '@nestjs/common';
import { RelationshipsService } from '../relationships.service';
import { CreateRelationshipDto } from '../dto/create-relationship.dto';
import { CreateTranslationDto } from '../dto/create-translation.dto';

@Injectable()
export class RelationshipSeeder {
  constructor(private readonly relationshipsService: RelationshipsService) {}

  async seed() {
    const relationships: CreateRelationshipDto[] = [
      { key: 'mother', description: 'Mother' },
      { key: 'father', description: 'Father' },
      { key: 'son', description: 'Son' },
      { key: 'daughter', description: 'Daughter' },
      { key: 'elder_brother', description: 'Elder Brother' },
      { key: 'younger_brother', description: 'Younger Brother' },
      { key: 'elder_sister', description: 'Elder Sister' },
      { key: 'younger_sister', description: 'Younger Sister' },
      { key: 'spouse_male', description: 'Husband' },
      { key: 'spouse_female', description: 'Wife' },
      { key: 'paternal_grandfather', description: 'Paternal Grandfather' },
      { key: 'paternal_grandmother', description: 'Paternal Grandmother' },
      { key: 'maternal_grandfather', description: 'Maternal Grandfather' },
      { key: 'maternal_grandmother', description: 'Maternal Grandmother' },
      { key: 'grandson', description: 'Grandson' },
      { key: 'granddaughter', description: 'Granddaughter' },
      {
        key: 'paternal_uncle_elder',
        description: "Father's Elder Brother (Periyappa)",
      },
      {
        key: 'paternal_uncle_younger',
        description: "Father's Younger Brother (Chinnaappa)",
      },
      { key: 'paternal_aunt', description: "Father's Sister" },
      {
        key: 'paternal_aunt_inlaw_elder',
        description: "Wife of Father's Elder Brother (Periyamma)",
      },
      {
        key: 'paternal_aunt_inlaw_younger',
        description: "Wife of Father's Younger Brother (Chithi)",
      },
      { key: 'maternal_uncle', description: "Mother's Brother" },
      {
        key: 'maternal_aunt_elder',
        description: 'Wife of Elder Maternal Uncle (Periyamma)',
      },
      {
        key: 'maternal_aunt_younger',
        description: 'Wife of Younger Maternal Uncle (Chithi)',
      },
      { key: 'maternal_aunt', description: "Mother's Sister" },
      { key: 'nephew', description: 'Nephew' },
      { key: 'niece', description: 'Niece' },
      { key: 'father_in_law', description: 'Father-in-law' },
      { key: 'mother_in_law', description: 'Mother-in-law' },
      {
        key: 'brother_in_law_younger',
        description: 'Brother-in-law (Younger)',
      },
      { key: 'sister_in_law_younger', description: 'Sister-in-law (Younger)' },
      { key: 'cousin_male', description: 'Male Cousin' },
      { key: 'cousin_female', description: 'Female Cousin' },
      { key: 'brother_in_law_by_sister', description: "Sister's Husband" },
      { key: 'sister_in_law_by_brother', description: "Brother's Wife" },
      {
        key: 'maternal_uncle_inlaw',
        description: "Husband of Mother's Sister",
      },
      {
        key: 'paternal_uncle_inlaw',
        description: "Husband of Father's Sister",
      },
    ];

    const translations: { key: string; language: string; label: string }[] = [
      // Mother translations
      { key: 'mother', language: 'en', label: 'Mother' },
      { key: 'mother', language: 'ta', label: 'அம்மா' },
      { key: 'mother', language: 'ml', label: 'അമ്മ' },
      { key: 'mother', language: 'hi', label: 'माँ' },
      { key: 'mother', language: 'ka', label: 'ಅಮ್ಮ' },

      // Father translations
      { key: 'father', language: 'en', label: 'Father' },
      { key: 'father', language: 'ta', label: 'அப்பா' },
      { key: 'father', language: 'ml', label: 'അച്ഛൻ' },
      { key: 'father', language: 'hi', label: 'पापा' },
      { key: 'father', language: 'ka', label: 'ಅಪ್ಪ' },

      // Son translations
      { key: 'son', language: 'en', label: 'Son' },
      { key: 'son', language: 'ta', label: 'மகன்' },
      { key: 'son', language: 'ml', label: 'മകൻ' },
      { key: 'son', language: 'hi', label: 'बेटा' },
      { key: 'son', language: 'ka', label: 'ಮಗ' },

      // Daughter translations
      { key: 'daughter', language: 'en', label: 'Daughter' },
      { key: 'daughter', language: 'ta', label: 'மகள்' },
      { key: 'daughter', language: 'ml', label: 'മകൾ' },
      { key: 'daughter', language: 'hi', label: 'बेटी' },
      { key: 'daughter', language: 'ka', label: 'ಮಗಳು' },

      // Elder Brother translations
      { key: 'elder_brother', language: 'en', label: 'Elder Brother' },
      { key: 'elder_brother', language: 'ta', label: 'அண்ணா' },
      { key: 'elder_brother', language: 'ml', label: 'ചേട്ടൻ' },
      { key: 'elder_brother', language: 'hi', label: 'भैया' },
      { key: 'elder_brother', language: 'ka', label: 'ಅಣ್ಣ' },

      // Younger Brother translations
      { key: 'younger_brother', language: 'en', label: 'Younger Brother' },
      { key: 'younger_brother', language: 'ta', label: 'தம்பி' },
      { key: 'younger_brother', language: 'ml', label: 'അനിയൻ' },
      { key: 'younger_brother', language: 'hi', label: 'छोटा भाई' },
      { key: 'younger_brother', language: 'ka', label: 'ತಮ್ಮ' },

      // Elder Sister translations
      { key: 'elder_sister', language: 'en', label: 'Elder Sister' },
      { key: 'elder_sister', language: 'ta', label: 'அக்கா' },
      { key: 'elder_sister', language: 'ml', label: 'ചേച്ചി' },
      { key: 'elder_sister', language: 'hi', label: 'दीदी' },
      { key: 'elder_sister', language: 'ka', label: 'ಅಕ್ಕ' },

      // Younger Sister translations
      { key: 'younger_sister', language: 'en', label: 'Younger Sister' },
      { key: 'younger_sister', language: 'ta', label: 'தங்கை' },
      { key: 'younger_sister', language: 'ml', label: 'സഹോദരി / ചെറി' },
      { key: 'younger_sister', language: 'hi', label: 'छोटी बहन' },
      { key: 'younger_sister', language: 'ka', label: 'ತಂಗಿ' },

      // Spouse Male (Husband) translations
      { key: 'spouse_male', language: 'en', label: 'Husband' },
      { key: 'spouse_male', language: 'ta', label: 'கணவர்' },
      { key: 'spouse_male', language: 'ml', label: 'ഭർത്താവ്' },
      { key: 'spouse_male', language: 'hi', label: 'पति' },
      { key: 'spouse_male', language: 'ka', label: 'ಗಂಡ' },

      // Spouse Female (Wife) translations
      { key: 'spouse_female', language: 'en', label: 'Wife' },
      { key: 'spouse_female', language: 'ta', label: 'மனைவி' },
      { key: 'spouse_female', language: 'ml', label: 'ഭാര്യ' },
      { key: 'spouse_female', language: 'hi', label: 'पत्नी' },
      { key: 'spouse_female', language: 'ka', label: 'ಹೆಂಡತಿ' },

      // Paternal Grandfather translations
      {
        key: 'paternal_grandfather',
        language: 'en',
        label: 'Paternal Grandfather',
      },
      { key: 'paternal_grandfather', language: 'ta', label: 'தாத்தா' },
      { key: 'paternal_grandfather', language: 'ml', label: 'പിതാമഹൻ' },
      { key: 'paternal_grandfather', language: 'hi', label: 'दादा' },
      { key: 'paternal_grandfather', language: 'ka', label: 'ಅಜ್ಜ' },

      // Paternal Grandmother translations
      {
        key: 'paternal_grandmother',
        language: 'en',
        label: 'Paternal Grandmother',
      },
      { key: 'paternal_grandmother', language: 'ta', label: 'பாட்டி' },
      { key: 'paternal_grandmother', language: 'ml', label: 'പിതാമ്മ' },
      { key: 'paternal_grandmother', language: 'hi', label: 'दादी' },
      { key: 'paternal_grandmother', language: 'ka', label: 'ಅಜ್ಜಿ' },

      // Maternal Grandfather translations
      {
        key: 'maternal_grandfather',
        language: 'en',
        label: 'Maternal Grandfather',
      },
      { key: 'maternal_grandfather', language: 'ta', label: 'தாத்தா' },
      { key: 'maternal_grandfather', language: 'ml', label: 'മുത്തച്ഛൻ' },
      { key: 'maternal_grandfather', language: 'hi', label: 'नाना' },
      { key: 'maternal_grandfather', language: 'ka', label: 'ಅಜ್ಜ' },

      // Maternal Grandmother translations
      {
        key: 'maternal_grandmother',
        language: 'en',
        label: 'Maternal Grandmother',
      },
      { key: 'maternal_grandmother', language: 'ta', label: 'பாட்டி' },
      { key: 'maternal_grandmother', language: 'ml', label: 'അമ്മുമ്മ' },
      { key: 'maternal_grandmother', language: 'hi', label: 'नानी' },
      { key: 'maternal_grandmother', language: 'ka', label: 'ಅಜ್ಜಿ' },

      // Grandson translations
      { key: 'grandson', language: 'en', label: 'Grandson' },
      { key: 'grandson', language: 'ta', label: 'பேரன்' },
      { key: 'grandson', language: 'ml', label: 'കൊച്ചുമകൻ' },
      { key: 'grandson', language: 'hi', label: 'पोता' },
      { key: 'grandson', language: 'ka', label: 'ಮೊಮ್ಮಗ' },

      // Granddaughter translations
      { key: 'granddaughter', language: 'en', label: 'Granddaughter' },
      { key: 'granddaughter', language: 'ta', label: 'பேத்தி' },
      { key: 'granddaughter', language: 'ml', label: 'കൊച്ചുമകൾ' },
      { key: 'granddaughter', language: 'hi', label: 'पोती' },
      { key: 'granddaughter', language: 'ka', label: 'ಮೊಮ್ಮಗಳು' },

      // Paternal Uncle Elder translations
      {
        key: 'paternal_uncle_elder',
        language: 'en',
        label: "Father's Elder Brother (Periyappa)",
      },
      { key: 'paternal_uncle_elder', language: 'ta', label: 'பெரியப்பா' },
      { key: 'paternal_uncle_elder', language: 'ml', label: 'വലിയപ്പൻ' },
      { key: 'paternal_uncle_elder', language: 'hi', label: 'ताऊजी' },
      { key: 'paternal_uncle_elder', language: 'ka', label: 'ದೊಡ್ಡಪ್ಪ' },

      // Paternal Uncle Younger translations
      {
        key: 'paternal_uncle_younger',
        language: 'en',
        label: "Father's Younger Brother (Chinnaappa)",
      },
      { key: 'paternal_uncle_younger', language: 'ta', label: 'சித்தப்பா' },
      { key: 'paternal_uncle_younger', language: 'ml', label: 'ചെറിയപ്പൻ' },
      { key: 'paternal_uncle_younger', language: 'hi', label: 'चाचाजी' },
      { key: 'paternal_uncle_younger', language: 'ka', label: 'ಚಿಕ್ಕಪ್ಪ' },

      // Paternal Aunt translations
      { key: 'paternal_aunt', language: 'en', label: "Father's Sister" },
      { key: 'paternal_aunt', language: 'ta', label: 'அத்தை' },
      { key: 'paternal_aunt', language: 'ml', label: 'പിതൃസഹോദരി' },
      { key: 'paternal_aunt', language: 'hi', label: 'बुआ' },
      { key: 'paternal_aunt', language: 'ka', label: 'ಅತ್ತೆ' },

      // Paternal Aunt In-law Elder translations
      {
        key: 'paternal_aunt_inlaw_elder',
        language: 'en',
        label: "Wife of Father's Elder Brother (Periyamma)",
      },
      { key: 'paternal_aunt_inlaw_elder', language: 'ta', label: 'பெரியம்மா' },
      { key: 'paternal_aunt_inlaw_elder', language: 'ml', label: 'വലിയമ്മ' },
      { key: 'paternal_aunt_inlaw_elder', language: 'hi', label: 'ताई' },
      { key: 'paternal_aunt_inlaw_elder', language: 'ka', label: 'ದೊಡ್ಡಮ್ಮ' },

      // Paternal Aunt In-law Younger translations
      {
        key: 'paternal_aunt_inlaw_younger',
        language: 'en',
        label: "Wife of Father's Younger Brother (Chithi)",
      },
      { key: 'paternal_aunt_inlaw_younger', language: 'ta', label: 'சித்தி' },
      { key: 'paternal_aunt_inlaw_younger', language: 'ml', label: 'ചെറിയമ്മ' },
      { key: 'paternal_aunt_inlaw_younger', language: 'hi', label: 'चाची' },
      { key: 'paternal_aunt_inlaw_younger', language: 'ka', label: 'ಚಿಕ್ಕಮ್ಮ' },

      // Maternal Uncle translations
      { key: 'maternal_uncle', language: 'en', label: "Mother's Brother" },
      { key: 'maternal_uncle', language: 'ta', label: 'மாமா' },
      { key: 'maternal_uncle', language: 'ml', label: 'അമ്മാവൻ' },
      { key: 'maternal_uncle', language: 'hi', label: 'मामा' },
      { key: 'maternal_uncle', language: 'ka', label: 'ಮಾವ' },

      // Maternal Aunt Elder translations
      {
        key: 'maternal_aunt_elder',
        language: 'en',
        label: 'Wife of Elder Maternal Uncle (Periyamma)',
      },
      { key: 'maternal_aunt_elder', language: 'ta', label: 'பெரியம்மா' },
      { key: 'maternal_aunt_elder', language: 'ml', label: 'വലിയമ്മ' },
      { key: 'maternal_aunt_elder', language: 'hi', label: 'मामी (बड़ी)' },
      { key: 'maternal_aunt_elder', language: 'ka', label: 'ದೊಡ್ಡಮಾವಿ' },

      // Maternal Aunt Younger translations
      {
        key: 'maternal_aunt_younger',
        language: 'en',
        label: 'Wife of Younger Maternal Uncle (Chithi)',
      },
      { key: 'maternal_aunt_younger', language: 'ta', label: 'சித்தி' },
      { key: 'maternal_aunt_younger', language: 'ml', label: 'ചെറിയമ്മ' },
      { key: 'maternal_aunt_younger', language: 'hi', label: 'मामी (छोटी)' },
      { key: 'maternal_aunt_younger', language: 'ka', label: 'ಚಿಕ್ಕಮಾವಿ' },

      // Maternal Aunt translations
      { key: 'maternal_aunt', language: 'en', label: "Mother's Sister" },
      { key: 'maternal_aunt', language: 'ta', label: 'மாமி' },
      { key: 'maternal_aunt', language: 'ml', label: 'അമ്മായി' },
      { key: 'maternal_aunt', language: 'hi', label: 'मासी' },
      { key: 'maternal_aunt', language: 'ka', label: 'ಅತ್ತೆ' },

      // Nephew translations
      { key: 'nephew', language: 'en', label: 'Nephew' },
      { key: 'nephew', language: 'ta', label: 'மருமகன்' },
      { key: 'nephew', language: 'ml', label: 'അനന്തരവൻ' },
      { key: 'nephew', language: 'hi', label: 'भतीजा' },
      { key: 'nephew', language: 'ka', label: 'ಸೋದರ ಮಗ' },

      // Niece translations
      { key: 'niece', language: 'en', label: 'Niece' },
      { key: 'niece', language: 'ta', label: 'மருமகள்' },
      { key: 'niece', language: 'ml', label: 'അനന്തരവള' },
      { key: 'niece', language: 'hi', label: 'भतीजी' },
      { key: 'niece', language: 'ka', label: 'ಸೋದರ ಮಗಳು' },

      // Father-in-law translations
      { key: 'father_in_law', language: 'en', label: 'Father-in-law' },
      { key: 'father_in_law', language: 'ta', label: 'மாமனார்' },
      { key: 'father_in_law', language: 'ml', label: 'മാമൻ' },
      { key: 'father_in_law', language: 'hi', label: 'ससुर' },
      { key: 'father_in_law', language: 'ka', label: 'ಮಾವ' },

      // Mother-in-law translations
      { key: 'mother_in_law', language: 'en', label: 'Mother-in-law' },
      { key: 'mother_in_law', language: 'ta', label: 'மாமியார்' },
      { key: 'mother_in_law', language: 'ml', label: 'അമ്മായിമ്മ' },
      { key: 'mother_in_law', language: 'hi', label: 'सास' },
      { key: 'mother_in_law', language: 'ka', label: 'ಅತ್ತೆ' },

      // Brother-in-law Younger translations
      {
        key: 'brother_in_law_younger',
        language: 'en',
        label: 'Brother-in-law (Younger)',
      },
      { key: 'brother_in_law_younger', language: 'ta', label: 'மச்சான்' },
      { key: 'brother_in_law_younger', language: 'ml', label: 'ബാല്യനായകൻ' },
      { key: 'brother_in_law_younger', language: 'hi', label: 'देवर / साला' },
      { key: 'brother_in_law_younger', language: 'ka', label: 'ಮೈದುನ' },

      // Sister-in-law Younger translations
      {
        key: 'sister_in_law_younger',
        language: 'en',
        label: 'Sister-in-law (Younger)',
      },
      { key: 'sister_in_law_younger', language: 'ta', label: 'மச்சினி' },
      { key: 'sister_in_law_younger', language: 'ml', label: 'ബാല്യനായിക' },
      { key: 'sister_in_law_younger', language: 'hi', label: 'ननद / साली' },
      { key: 'sister_in_law_younger', language: 'ka', label: 'ನಾದಿನಿ' },

      // Cousin Male translations
      { key: 'cousin_male', language: 'en', label: 'Male Cousin' },
      { key: 'cousin_male', language: 'ta', label: 'மைத்துனர்' },
      { key: 'cousin_male', language: 'ml', label: 'സഹോദരൻ' },
      { key: 'cousin_male', language: 'hi', label: 'चचेरा भाई' },
      { key: 'cousin_male', language: 'ka', label: 'ಸೋದರ' },

      // Cousin Female translations
      { key: 'cousin_female', language: 'en', label: 'Female Cousin' },
      { key: 'cousin_female', language: 'ta', label: 'மைத்துனி' },
      { key: 'cousin_female', language: 'ml', label: 'സഹോദരി' },
      { key: 'cousin_female', language: 'hi', label: 'चचेरी बहन' },
      { key: 'cousin_female', language: 'ka', label: 'ಸೋದರಿ' },

      // Brother-in-law by Sister translations
      {
        key: 'brother_in_law_by_sister',
        language: 'en',
        label: "Sister's Husband",
      },
      { key: 'brother_in_law_by_sister', language: 'ta', label: 'மச்சான்' },
      {
        key: 'brother_in_law_by_sister',
        language: 'ml',
        label: 'അനിയന്റെ ഭര്‍ത്താവ്',
      },
      { key: 'brother_in_law_by_sister', language: 'hi', label: 'बहन का पति' },
      { key: 'brother_in_law_by_sister', language: 'ka', label: 'ಅಳಿಯ' },

      // Sister-in-law by Brother translations
      {
        key: 'sister_in_law_by_brother',
        language: 'en',
        label: "Brother's Wife",
      },
      { key: 'sister_in_law_by_brother', language: 'ta', label: 'அண்ணி' },
      {
        key: 'sister_in_law_by_brother',
        language: 'ml',
        label: 'സഹോദരന്റെ ഭാര്യ',
      },
      { key: 'sister_in_law_by_brother', language: 'hi', label: 'भाभी' },
      { key: 'sister_in_law_by_brother', language: 'ka', label: 'ವಧು' },

      // Maternal Uncle In-law translations
      {
        key: 'maternal_uncle_inlaw',
        language: 'en',
        label: "Husband of Mother's Sister",
      },
      { key: 'maternal_uncle_inlaw', language: 'ta', label: 'மாமா' },
      { key: 'maternal_uncle_inlaw', language: 'ml', label: 'അമ്മാവൻ' },
      { key: 'maternal_uncle_inlaw', language: 'hi', label: 'मामा' },
      { key: 'maternal_uncle_inlaw', language: 'ka', label: 'ಮಾವ' },

      // Paternal Uncle In-law translations
      {
        key: 'paternal_uncle_inlaw',
        language: 'en',
        label: "Husband of Father's Sister",
      },
      {
        key: 'paternal_uncle_inlaw',
        language: 'ta',
        label: 'மாமா / சித்தப்பா',
      },
      { key: 'paternal_uncle_inlaw', language: 'ml', label: 'പിതൃസഹോദരൻ' },
      { key: 'paternal_uncle_inlaw', language: 'hi', label: 'फूफा' },
      { key: 'paternal_uncle_inlaw', language: 'ka', label: 'ಅತ್ತಿಗೆ' },
    ];

    console.log('Starting relationship seeding...');

    for (const rel of relationships) {
      try {
        // Try to find existing relationship first
        const existing = await this.relationshipsService.findByKey(rel.key);
        let relationship;

        if (existing) {
          console.log(
            `Relationship '${rel.key}' already exists, skipping creation`,
          );
          relationship = existing;
        } else {
          console.log(`Creating relationship '${rel.key}'`);
          relationship =
            await this.relationshipsService.createRelationship(rel);
        }

        // Add translations for this relationship
        const relTranslations = translations.filter((t) => t.key === rel.key);
        for (const trans of relTranslations) {
          try {
            await this.relationshipsService.addTranslation(relationship.id, {
              language: trans.language,
              label: trans.label,
            } as CreateTranslationDto);
            console.log(
              `Added translation for '${rel.key}' in '${trans.language}': '${trans.label}'`,
            );
          } catch (error) {
            // Translation might already exist, log and continue
            console.log(
              `Translation for '${rel.key}' in '${trans.language}' might already exist, skipping`,
            );
          }
        }
      } catch (error) {
        console.error(
          `Error processing relationship '${rel.key}':`,
          error.message,
        );
        // Continue with next relationship instead of failing completely
      }
    }

    console.log('Relationship seeding completed');
  }
}
