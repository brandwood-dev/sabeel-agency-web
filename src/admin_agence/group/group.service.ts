import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AgencyGroup, GroupStatus } from './entities/group.entity';
import { User, UserRole } from '../../sabeel/auth/entities/user.entity';
import { MinioService } from '../../minio/minio.service';

@Injectable()
export class GroupService {
  constructor(
    @InjectRepository(AgencyGroup)
    private groupRepository: Repository<AgencyGroup>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private minioService: MinioService,
  ) {}

  async create(agencyId: string, data: any) {
    const group = this.groupRepository.create({
      ...data,
      agencyId,
    });
    const saved = await this.groupRepository.save(group);
    return this.mapGroup(saved as any);
  }

  async findAll(agencyId: string) {
    const groups = await this.groupRepository.find({
      where: { agencyId },
      relations: ['pack', 'guide', 'pilgrims'],
      order: { createdAt: 'DESC' },
    });
    return Promise.all(groups.map((g) => this.mapGroup(g)));
  }

  async findOne(id: string, agencyId: string) {
    const group = await this.groupRepository.findOne({
      where: { id, agencyId },
      relations: ['pack', 'guide', 'pilgrims'],
    });
    if (!group) throw new NotFoundException('Group not found');
    return this.mapGroup(group);
  }

  async update(id: string, agencyId: string, data: any) {
    const group = await this.groupRepository.findOne({ where: { id, agencyId } });
    if (!group) throw new NotFoundException('Group not found');

    Object.assign(group, data);
    const saved = await this.groupRepository.save(group);
    return this.mapGroup(saved as any);
  }

  private async mapGroup(group: AgencyGroup) {
    const imageUrl = group.imageUrl
      ? await this.minioService.getFileUrl('images', group.imageUrl).catch(() => group.imageUrl)
      : null;

    return {
      ...group,
      imageUrl,
    };
  }

  async delete(id: string, agencyId: string) {
    const group = await this.groupRepository.findOne({ where: { id, agencyId } });
    if (!group) throw new NotFoundException('Group not found');
    
    // Unassign pilgrims before deleting
    await this.userRepository.update({ groupId: id }, { groupId: null });
    
    return this.groupRepository.remove(group);
  }

  async archive(id: string, agencyId: string) {
    const group = await this.groupRepository.findOne({ where: { id, agencyId } });
    if (!group) throw new NotFoundException('Group not found');
    group.status = GroupStatus.ARCHIVED;
    return this.groupRepository.save(group);
  }

  async unarchive(id: string, agencyId: string) {
    const group = await this.groupRepository.findOne({ where: { id, agencyId } });
    if (!group) throw new NotFoundException('Group not found');
    group.status = GroupStatus.ACTIVE;
    return this.groupRepository.save(group);
  }

  async getAvailablePilgrims(agencyId: string) {
    // Return pelerins who don't have a group
    // In a real app, we might filter by those who booked with this agency
    return this.userRepository.find({
      where: {
        activeRole: UserRole.PELEGRIN,
        groupId: IsNull(),
      },
      select: ['id', 'firstName', 'lastName', 'email', 'phoneNumber', 'photo'],
    });
  }

  async assignPilgrims(id: string, agencyId: string, pilgrimIds: string[]) {
    const group = await this.groupRepository.findOne({ 
      where: { id, agencyId },
      relations: ['pilgrims']
    });
    if (!group) throw new NotFoundException('Group not found');

    const currentPilgrimCount = group.pilgrims?.length || 0;
    if (currentPilgrimCount + pilgrimIds.length > group.capacity) {
      throw new BadRequestException(`Capacité dépassée. Capacité max: ${group.capacity}, déjà assignés: ${currentPilgrimCount}`);
    }

    await this.userRepository.update(
      { id: In(pilgrimIds) },
      { groupId: id }
    );

    return this.findOne(id, agencyId);
  }

  async removePilgrim(id: string, agencyId: string, pilgrimId: string) {
    const group = await this.groupRepository.findOne({ where: { id, agencyId } });
    if (!group) throw new NotFoundException('Group not found');

    await this.userRepository.update(
      { id: pilgrimId, groupId: id },
      { groupId: null }
    );

    return this.findOne(id, agencyId);
  }
}
