import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** A note as the API returns it. */
export class Note {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ship the first endpoint' })
  title: string;

  @ApiProperty({ example: 'List, get and create, with tests.' })
  body: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

/** POST /v1/notes. Unknown fields are a 400 (forbidNonWhitelisted). */
export class CreateNoteDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiPropertyOptional({ maxLength: 10_000, default: '' })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  body = '';
}

/** GET /v1/notes query. Unknown keys are a 400. */
export class ListNotesQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'nextCursor from the previous page',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class NotePage {
  @ApiProperty({ type: [Note] })
  items: Note[];

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  nextCursor: string | null;
}
