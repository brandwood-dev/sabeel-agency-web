import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PackUmrah, PackUmrahStatus } from './entities/pack-umrah.entity';
import { AdminAgenceUser, AdminAgenceRole } from '../auth/entities/admin-agence-user.entity';
import { SavePackUmrahDto } from './dto/save-pack-umrah.dto';
import { MinioService } from '../../minio/minio.service';

@Injectable()
export class PackUmrahService {
  constructor(
    @InjectRepository(PackUmrah)
    private packRepository: Repository<PackUmrah>,
    @InjectRepository(AdminAgenceUser)
    private agencyRepository: Repository<AdminAgenceUser>,
    private readonly minioService: MinioService,
  ) {}

  private assertAgencyCanUsePlatform(agency: AdminAgenceUser) {
    if (agency.status !== 'active') {
      throw new ForbiddenException('Agency profile must be verified to use this feature');
    }
  }

  private isProfileVerified(agency: AdminAgenceUser): boolean {
    return agency.status === 'active';
  }

  private convertPriceToNumber(dto: SavePackUmrahDto): any {
    const result: any = Object.assign({}, dto);
    if (dto.price !== undefined && dto.price !== null) {
      result.price = parseFloat(dto.price);
    }
    if (dto.priceSharedRoom !== undefined && dto.priceSharedRoom !== null) {
      result.priceSharedRoom = dto.priceSharedRoom;
    }
    if (dto.priceIndividualRoom !== undefined && dto.priceIndividualRoom !== null) {
      result.priceIndividualRoom = dto.priceIndividualRoom;
    }
    if (dto.priceAdult !== undefined && dto.priceAdult !== null) {
      result.priceAdult = dto.priceAdult;
    }
    if (dto.priceChild !== undefined && dto.priceChild !== null) {
      result.priceChild = dto.priceChild;
    }
    if (dto.priceSenior !== undefined && dto.priceSenior !== null) {
      result.priceSenior = dto.priceSenior;
    }
    return result;
  }

  private async mapPack(pack: PackUmrah, agency?: AdminAgenceUser | null) {
    const imageUrl = pack.imageUrl
      ? this.minioService.getPublicFileUrl('images', pack.imageUrl)
      : null;
    const agencyLogo = agency?.profileImagePath
      ? this.minioService.getPublicFileUrl('images', agency.profileImagePath)
      : null;

    return {
      ...pack,
      imageUrl,
      agencyName: agency?.agencyName || agency?.fullName || '',
      agencyLogo,
    };
  }

  async create(currentUser: { userId: string; activeRole: string }, dto: SavePackUmrahDto) {
    if (currentUser.activeRole !== AdminAgenceRole.AGENCE) {
      throw new ForbiddenException('Only agencies can create packs');
    }

    const agency = await this.agencyRepository.findOne({ where: { id: currentUser.userId } });
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    this.assertAgencyCanUsePlatform(agency);

    const isVerified = this.isProfileVerified(agency);
    const convertedDto = this.convertPriceToNumber(dto);

    const pack = this.packRepository.create({
      ...convertedDto,
      agencyId: agency.id,
      status: isVerified ? PackUmrahStatus.APPROVED : PackUmrahStatus.PENDING,
    });

    const saved = await this.packRepository.save(pack);
    return { pack: saved };
  }

  async update(
    currentUser: { userId: string; activeRole: string },
    packId: string,
    dto: SavePackUmrahDto,
  ) {
    if (currentUser.activeRole !== AdminAgenceRole.AGENCE) {
      throw new ForbiddenException('Only agencies can update packs');
    }

    const pack = await this.packRepository.findOne({ where: { id: packId } });
    if (!pack) {
      throw new NotFoundException('Pack not found');
    }

    if (pack.agencyId !== currentUser.userId) {
      throw new ForbiddenException('You can only update your own packs');
    }

    const agency = await this.agencyRepository.findOne({ where: { id: currentUser.userId } });
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }

    this.assertAgencyCanUsePlatform(agency);

    const isVerified = this.isProfileVerified(agency);
    const convertedDto = this.convertPriceToNumber(dto);

    Object.assign(pack, {
      ...convertedDto,
      status: isVerified ? PackUmrahStatus.APPROVED : PackUmrahStatus.PENDING,
    });

    const saved = await this.packRepository.save(pack);
    return { pack: saved };
  }

  async getPackById(
    currentUser: { userId: string; activeRole: string },
    packId: string,
  ) {
    const pack = await this.packRepository.findOne({ where: { id: packId } });
    if (!pack) {
      throw new NotFoundException('Pack not found');
    }
    return { pack };
  }

  async getPacksByAgencyId(
    currentUser: { userId: string; activeRole: string },
    agencyId: string,
  ) {
    const packs = await this.packRepository.find({
      where: { agencyId },
      order: { createdAt: 'DESC' },
    });
    return { packs };
  }

  async countAgencyPacks(
    currentUser: { userId: string; activeRole: string },
    agencyId: string,
  ) {
    const count = await this.packRepository.count({ where: { agencyId } });
    return { count };
  }

  async getAgencyPacks(currentUser: { userId: string; activeRole: string }) {
    const packs = await this.packRepository.find({
      where: { agencyId: currentUser.userId },
      order: { createdAt: 'DESC' },
    });
    return { packs };
  }

  async getPublicPacks() {
    const packs = await this.packRepository.find({
      where: {
        status: PackUmrahStatus.APPROVED,
        isVisible: true,
        isArchived: false,
      },
      order: { createdAt: 'DESC' },
    });

    const agencyIds = Array.from(new Set(packs.map((pack) => pack.agencyId).filter(Boolean)));
    const agencies = agencyIds.length
      ? await this.agencyRepository.find({ where: agencyIds.map((id) => ({ id })) })
      : [];
    const agencyById = new Map(agencies.map((agency) => [agency.id, agency]));

    const mappedPacks = await Promise.all(
      packs.map((pack) => this.mapPack(pack, agencyById.get(pack.agencyId) || null))
    );

    return {
      packs: mappedPacks,
    };
  }

  async getPublicPackById(packId: string) {
    const pack = await this.packRepository.findOne({ where: { id: packId } });
    if (!pack || pack.status !== PackUmrahStatus.APPROVED || !pack.isVisible || pack.isArchived) {
      throw new NotFoundException('Pack not found');
    }

    const agency = pack.agencyId
      ? await this.agencyRepository.findOne({ where: { id: pack.agencyId } })
      : null;

    return {
      pack: await this.mapPack(pack, agency),
    };
  }

  async getAllPacks(currentUser: { userId: string; activeRole: string }) {
    const packs = await this.packRepository.find({
      order: { createdAt: 'DESC' },
    });
    return { packs };
  }

  async updateStatus(
    currentUser: { userId: string; activeRole: string },
    packId: string,
    status: PackUmrahStatus,
  ) {
    if (currentUser.activeRole !== AdminAgenceRole.ADMIN && currentUser.activeRole !== AdminAgenceRole.SUB_ADMIN) {
      throw new ForbiddenException('Only admins can update pack status');
    }

    const pack = await this.packRepository.findOne({ where: { id: packId } });
    if (!pack) {
      throw new NotFoundException('Pack not found');
    }
    pack.status = status;
    const saved = await this.packRepository.save(pack);
    return { pack: saved };
  }

  async remove(currentUser: { userId: string; activeRole: string }, packId: string) {
    if (currentUser.activeRole !== AdminAgenceRole.AGENCE) {
      throw new ForbiddenException('Only agencies can delete packs');
    }

    const pack = await this.packRepository.findOne({ where: { id: packId } });
    if (!pack) {
      throw new NotFoundException('Pack not found');
    }

    if (pack.agencyId !== currentUser.userId) {
      throw new ForbiddenException('You can only delete your own packs');
    }

    await this.packRepository.remove(pack);
    return { message: 'Pack deleted successfully' };
  }
}
