import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrganisationsService } from '../organisations.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EmailService } from '../../../email/email.service';
import { AuditService } from '../../audit/audit.service';

const mockPrisma = {
  organisation: { findUnique: jest.fn() },
};

describe('OrganisationsService.getPublicBranding', () => {
  let service: OrganisationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganisationsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: {} },
        { provide: AuditService, useValue: {} },
      ],
    }).compile();
    service = module.get(OrganisationsService);
  });

  it('returns only cosmetic fields for an active org', async () => {
    mockPrisma.organisation.findUnique.mockResolvedValue({
      slug: 'acme', name: 'Acme', logoUrl: 'https://x/logo.png', primaryColor: '#ff5533', isActive: true, deletedAt: null,
    });
    const r = await service.getPublicBranding('acme');
    expect(r).toEqual({ slug: 'acme', name: 'Acme', logoUrl: 'https://x/logo.png', primaryColor: '#ff5533' });
    // must not leak other org fields
    expect(Object.keys(r).sort()).toEqual(['logoUrl', 'name', 'primaryColor', 'slug']);
  });

  it('404s on unknown slug', async () => {
    mockPrisma.organisation.findUnique.mockResolvedValue(null);
    await expect(service.getPublicBranding('nope')).rejects.toThrow(NotFoundException);
  });

  it('404s on inactive or soft-deleted org', async () => {
    mockPrisma.organisation.findUnique.mockResolvedValue({
      slug: 'gone', name: 'Gone', logoUrl: null, isActive: false, deletedAt: null,
    });
    await expect(service.getPublicBranding('gone')).rejects.toThrow(NotFoundException);

    mockPrisma.organisation.findUnique.mockResolvedValue({
      slug: 'del', name: 'Del', logoUrl: null, isActive: true, deletedAt: new Date(),
    });
    await expect(service.getPublicBranding('del')).rejects.toThrow(NotFoundException);
  });
});
