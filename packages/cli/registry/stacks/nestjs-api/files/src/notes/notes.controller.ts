import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorEnvelope } from '../common/error-envelope.dto.js';
import { CreateNoteDto, ListNotesQuery, Note, NotePage } from './dto/note.dto.js';
import { NotesService } from './notes.service.js';

@ApiTags('notes')
@ApiBadRequestResponse({
  type: ErrorEnvelope,
  description: 'Invalid input',
})
@Controller({ path: 'notes', version: '1' })
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  @ApiOkResponse({ type: NotePage, description: 'A page of notes, oldest first' })
  list(@Query() query: ListNotesQuery): Promise<NotePage> {
    return this.notes.list(query);
  }

  @Get(':id')
  @ApiOkResponse({ type: Note })
  @ApiNotFoundResponse({ type: ErrorEnvelope, description: 'No note with this id' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Note> {
    return this.notes.get(id);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({
    type: Note,
    description: 'The created note; Location names it',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorEnvelope,
    description: 'Body over the size limit',
  })
  async create(
    @Body() input: CreateNoteDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Note> {
    const note = await this.notes.create(input);
    res.location(`/v1/notes/${note.id}`);
    return note;
  }
}
