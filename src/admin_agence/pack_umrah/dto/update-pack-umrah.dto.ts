import { PartialType } from '@nestjs/mapped-types';
import { CreatePackUmrahDto } from './create-pack-umrah.dto';

export class UpdatePackUmrahDto extends PartialType(CreatePackUmrahDto) {}
