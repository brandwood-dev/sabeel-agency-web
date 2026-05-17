import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { AdminAgenceUser, AdminAgenceRole } from '../admin_agence/auth/entities/admin-agence-user.entity';
import { PackUmrah } from '../admin_agence/pack_umrah/entities/pack-umrah.entity';
import { AgencyGuide } from '../admin_agence/guide/entities/guide.entity';
import { Booking } from '../admin_agence/booking/entities/booking.entity';
import { AgencyGroup } from '../admin_agence/group/entities/group.entity';

@Injectable()
export class AiService {
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly systemPromptBase: string;

  constructor(
    private configService: ConfigService,
    @InjectRepository(AdminAgenceUser)
    private readonly agencyRepository: Repository<AdminAgenceUser>,
    @InjectRepository(PackUmrah)
    private readonly packRepository: Repository<PackUmrah>,
    @InjectRepository(AgencyGuide)
    private readonly guideRepository: Repository<AgencyGuide>,
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,
    @InjectRepository(AgencyGroup)
    private readonly groupRepository: Repository<AgencyGroup>,
  ) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';
    this.apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent';
    
    // Base System Prompt for Sabeel's ecosystem
    this.systemPromptBase = `
      Tu es l'assistant intelligent de Sabeel, une plateforme innovante de gestion du Hajj et de l'Umrah.
      Réponds de manière concise, professionnelle et chaleureuse.
      
      CONNAISSANCES SUR SABEEL :
      1. Sabeel Agence (Web) : Portail pour les agences de voyages.
      2. Sabeel Guide (Mobile) : Application pour les guides sur le terrain.
      3. Sabeel Pèlerin (Mobile) : Application pour les pèlerins.
      
      RÈGLES GÉNÉRALES :
      - NE RÉPONDS À AUCUNE QUESTION HORS SUJET (Si la question ne concerne pas Sabeel, le Hajj ou l'Umrah, réponds poliment que tu es là pour aider sur la plateforme Sabeel).
      - Encourage toujours l'utilisation de la plateforme.
    `;
  }

  async getAgencyData(userId: string) {
    let user = await this.agencyRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur non trouvé');

    let agencyId = userId;
    
    // If user is a sub-admin, we fetch data for the parent agency
    if (user.activeRole === AdminAgenceRole.SUB_ADMIN && user.createdById) {
      const parent = await this.agencyRepository.findOne({ where: { id: user.createdById } });
      if (parent && parent.activeRole === AdminAgenceRole.AGENCE) {
        user = parent;
        agencyId = parent.id;
      }
    }
    
    const agencyName = user.agencyName || user.fullName;

    const packs = await this.packRepository.find({ where: { agencyId } });
    const guides = await this.guideRepository.find({ where: { agencyId } });
    const bookings = await this.bookingRepository.find({ where: { agencyId }, relations: ['pack'] });
    const groups = await this.groupRepository.find({ where: { agencyId }, relations: ['guide', 'pack'] });

    // Financial calculations
    const totalRevenue = bookings.reduce((acc, b) => acc + Number(b.totalAmount || 0), 0);
    const amountPaid = bookings.reduce((acc, b) => acc + Number(b.amountPaid || 0), 0);
    const remainingAmount = totalRevenue - amountPaid;

    // Pack popularity
    const packPopularity = packs.map(p => ({
      title: p.title,
      bookingsCount: bookings.filter(b => b.packId === p.id).length,
      revenue: bookings.filter(b => b.packId === p.id).reduce((acc, b) => acc + Number(b.totalAmount || 0), 0)
    }));

    // Guide workload
    const guideWorkload = guides.map(g => ({
      name: g.fullName,
      groupsCount: groups.filter(gr => gr.guideId === g.id).length,
      status: g.status
    }));

    return {
      name: agencyName,
      packs: packPopularity,
      guides: guideWorkload,
      bookings: bookings.map(b => ({ status: b.status, paymentStatus: b.paymentStatus, date: b.createdAt })),
      stats: {
        totalPacks: packs.length,
        totalGuides: guides.length,
        totalPilgrims: bookings.length,
        totalGroups: groups.length,
        financial: {
          totalRevenue,
          amountPaid,
          remainingAmount,
        }
      }
    };
  }

  async generateContent(userPrompt: string, agencyId?: string, lang: string = 'fr') {
    try {
      let agencyContext = '';
      let greeting = 'Bonjour';

      if (agencyId) {
        const data = await this.getAgencyData(agencyId);
        greeting = `Bonjour ${data.name}`;
        
        agencyContext = `
          CONTEXTE DE L'AGENCE ACTUELLE :
          - Nom de l'agence : ${data.name}
          
          📊 STATISTIQUES GLOBALES :
          - Packs : ${data.stats.totalPacks}
          - Guides : ${data.stats.totalGuides}
          - Groupes : ${data.stats.totalGroups}
          - Pèlerins : ${data.stats.totalPilgrims}
          
          💰 SITUATION FINANCIÈRE :
          - Revenu total : ${data.stats.financial.totalRevenue} DT
          - Encaissé : ${data.stats.financial.amountPaid} DT
          - Créances : ${data.stats.financial.remainingAmount} DT
          
          📦 PERFORMANCE DES OFFRES (PACKS) :
          ${data.packs.map(p => `- ${p.title} : ${p.bookingsCount} réservations, Revenu: ${p.revenue} DT`).join('\n')}
          
          👤 CHARGE DE TRAVAIL DES GUIDES :
          ${data.guides.map(g => `- ${g.name} : ${g.groupsCount} groupes assignés (Statut: ${g.status})`).join('\n')}
          
          📈 TENDANCES PÈLERINS :
          - Répartition statuts : ${JSON.stringify(data.bookings.reduce((acc, b) => {
            acc[b.status] = (acc[b.status] || 0) + 1;
            return acc;
          }, {}))}
          
          CONSIGNES CRITIQUES :
          1. Tu DOIS impérativement commencer par : "${greeting}".
          2. Tu es l'Assistant Privé de ${data.name}. 
          3. Base tes réponses UNIQUEMENT sur les données fournies pour cette agence.
          4. INTERDICTION : Ne demande jamais à l'utilisateur qui il est.
          5. Analyse la santé financière et business comme un expert.
        `;
      } else {
        agencyContext = `
          RÔLE : Assistant Public Sabeel.
          CONTEXTE : Tu es sur la page d'accueil. Tes utilisateurs sont des pèlerins ou des agences intéressées.
          OBJECTIF : Expliquer les avantages de Sabeel, donner des infos générales sur le Hajj/Umrah.
          RESTRICTION : Tu n'as accès à AUCUNE donnée privée d'agence ici. Si on te pose une question sur une agence spécifique, explique qu'il faut se connecter à l'espace privé.
        `;
      }

      const languageMap = {
        fr: 'français',
        en: 'english',
        ar: 'arabic',
        es: 'spanish',
        pt: 'portuguese',
        it: 'italian',
        de: 'german'
      };
      
      const targetLang = languageMap[lang] || 'français';

      const contextPrompt = `
        ${this.systemPromptBase}
        ${agencyContext}
        
        The user's preferred language is ${targetLang}. 
        Please respond in ${targetLang} by default. 
        
        User Question: ${userPrompt}
      `;

      const response = await axios.post(
        `${this.apiUrl}?key=${this.apiKey}`,
        {
          contents: [
            {
              parts: [
                {
                  text: contextPrompt,
                },
              ],
            },
          ],
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      if (response.data?.candidates && response.data.candidates.length > 0) {
        return response.data.candidates[0].content.parts[0].text;
      }
      
      return "Je suis désolé, je n'ai pas pu générer de réponse.";
    } catch (error) {
      console.error('Gemini API Error:', error.response?.data || error.message);
      return "Désolé, je rencontre des difficultés techniques. Veuillez réessayer plus tard.";
    }
  }
}
