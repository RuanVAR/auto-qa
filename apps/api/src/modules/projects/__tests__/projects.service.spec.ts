import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from '../projects.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';

const mockProject = {
  id: 'proj-1',
  name: 'Demo App',
  slug: 'demo-app',
  description: 'Demo',
  isActive: true,
  deletedAt: null,
  ownerId: 'user-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  members: [],
};

const mockPrisma = {
  project: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  projectMember: {
    create: jest.fn(),
  },
  testDefinition: {
    count: jest.fn(),
  },
};

const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

describe('ProjectsService', () => {
  let service: ProjectsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAudit },
      ],
    }).compile();
    service = module.get<ProjectsService>(ProjectsService);
  });

  describe('findAll', () => {
    it('returns list of active projects', async () => {
      mockPrisma.project.findMany.mockResolvedValue([mockProject]);
      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(mockPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isActive: true }) }),
      );
    });
  });

  describe('getQuarantinedTestCount', () => {
    it('counts only active, non-deleted quarantined tests in the active org', async () => {
      mockPrisma.testDefinition.count.mockResolvedValue(3);

      await expect(service.getQuarantinedTestCount('org-1', 'ORG_ADMIN')).resolves.toBe(3);
      expect(mockPrisma.testDefinition.count).toHaveBeenCalledWith({
        where: {
          isActive: true,
          deletedAt: null,
          quarantineStatus: 'QUARANTINED',
          project: { orgId: 'org-1' },
        },
      });
    });

    it('does not expose a count without an active org', async () => {
      await expect(service.getQuarantinedTestCount()).resolves.toBe(0);
      expect(mockPrisma.testDefinition.count).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns a project by id', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(mockProject);
      const result = await service.findOne('proj-1');
      expect(result.id).toBe('proj-1');
    });

    it('throws NotFoundException when project does not exist', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a project with owner id', async () => {
      mockPrisma.project.create.mockResolvedValue(mockProject);
      mockPrisma.projectMember.create.mockResolvedValue({
        projectId: 'proj-1',
        userId: 'user-1',
        role: 'OWNER',
      });
      const result = await service.create({ name: 'Demo App', slug: 'demo-app' }, 'user-1');
      expect(result.name).toBe('Demo App');
      expect(mockPrisma.project.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ ownerId: 'user-1' }) }),
      );
      expect(mockPrisma.projectMember.create).toHaveBeenCalledWith({
        data: { projectId: 'proj-1', userId: 'user-1', role: 'OWNER' },
      });
    });
  });

  describe('update', () => {
    it('updates an existing project', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(mockProject);
      mockPrisma.project.update.mockResolvedValue({ ...mockProject, name: 'Updated' });
      const result = await service.update('proj-1', { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('throws NotFoundException when project does not exist', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(null);
      await expect(service.update('nonexistent', { name: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove (soft delete)', () => {
    it('soft-deletes by setting deletedAt and returns id', async () => {
      mockPrisma.project.findFirst.mockResolvedValue(mockProject);
      mockPrisma.project.update.mockResolvedValue({ ...mockProject, isActive: false });
      const result = await service.remove('proj-1');
      expect(result).toEqual({ id: 'proj-1' });
      expect(mockPrisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
      );
    });
  });
});
