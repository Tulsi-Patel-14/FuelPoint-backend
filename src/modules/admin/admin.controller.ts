import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { generateTokens } from '../../utils/jwt';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { email },
      include: { adminProfile: true }
    });

    if (!user || user.role !== 'ADMIN' || !user.password) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    res.status(200).json({
      success: true,
      data: {
        token: accessToken,
        admin: user.adminProfile
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const totalCustomers = await prisma.customerProfile.count();
    const totalWorkers = await prisma.workerProfile.count();
    
    const transactions = await prisma.transaction.aggregate({
      _count: { id: true },
      _sum: { amount: true, discountAmount: true }
    });

    res.status(200).json({
      success: true,
      data: {
        totalCustomers,
        totalWorkers,
        totalTransactions: transactions._count.id,
        totalRevenue: transactions._sum.amount || 0,
        totalDiscount: transactions._sum.discountAmount || 0,
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getCustomers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search } = req.query;
    const whereClause = search ? { fullName: { contains: search as string, mode: 'insensitive' as any } } : {};

    const customers = await prisma.customerProfile.findMany({
      where: whereClause,
      include: { group: true }
    });
    res.status(200).json({ success: true, data: customers });
  } catch (error) {
    next(error);
  }
};

export const getWorkers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workers = await prisma.workerProfile.findMany({
      include: { user: true, station: true }
    });
    res.status(200).json({ success: true, data: workers });
  } catch (error) {
    next(error);
  }
};

export const createWorker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fullName, email, mobile, password, shift, stationId } = req.body;

    if (!fullName) {
      return res.status(400).json({ success: false, message: 'Full name is required' });
    }

    if (email || mobile) {
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            ...(email ? [{ email }] : []),
            ...(mobile ? [{ mobile }] : [])
          ]
        }
      });
      if (existingUser) {
        return res.status(409).json({ success: false, message: 'User with this email or mobile already exists' });
      }
    }

    let hashedPassword = undefined;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const worker = await prisma.user.create({
      data: {
        email,
        mobile,
        password: hashedPassword,
        role: 'WORKER',
        workerProfile: {
          create: {
            fullName,
            shift,
            stationId
          }
        }
      },
      include: {
        workerProfile: {
          include: {
            station: true
          }
        }
      }
    });

    res.status(201).json({ success: true, data: worker.workerProfile });
  } catch (error) {
    next(error);
  }
};

export const getWorkerById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const worker = await prisma.workerProfile.findUnique({
      where: { id },
      include: { user: true, station: true }
    });

    if (!worker) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    res.status(200).json({ success: true, data: worker });
  } catch (error) {
    next(error);
  }
};

export const updateWorker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { fullName, email, mobile, password, shift, stationId, status } = req.body;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { id },
      include: { user: true }
    });

    if (!workerProfile) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    let hashedPassword = undefined;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    const updatedWorker = await prisma.workerProfile.update({
      where: { id },
      data: {
        fullName: fullName !== undefined ? fullName : undefined,
        shift: shift !== undefined ? shift : undefined,
        stationId: stationId !== undefined ? stationId : undefined,
        user: {
          update: {
            email: email !== undefined ? email : undefined,
            mobile: mobile !== undefined ? mobile : undefined,
            ...(hashedPassword && { password: hashedPassword }),
            ...(status && { status })
          }
        }
      },
      include: { user: true, station: true }
    });

    res.status(200).json({ success: true, data: updatedWorker });
  } catch (error) {
    next(error);
  }
};

export const deleteWorker = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;

    const workerProfile = await prisma.workerProfile.findUnique({
      where: { id }
    });

    if (!workerProfile) {
      return res.status(404).json({ success: false, message: 'Worker not found' });
    }

    await prisma.$transaction([
      prisma.workerProfile.delete({ where: { id } }),
      prisma.user.delete({ where: { id: workerProfile.userId } })
    ]);

    res.status(200).json({ success: true, message: 'Worker deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const getTransactions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const transactions = await prisma.transaction.findMany({
      include: { customer: true, worker: true, station: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    });
    
    const total = await prisma.transaction.count();

    res.status(200).json({ 
      success: true, 
      data: transactions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

export const getGroups = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const groups = await prisma.group.findMany();
    res.status(200).json({ success: true, data: groups });
  } catch (error) {
    next(error);
  }
};

export const getNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const notifications = await prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    next(error);
  }
};

export const getProfile = async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { adminProfile: true }
    });

    if (!user || !user.adminProfile) {
      return res.status(404).json({ success: false, message: 'Admin profile not found' });
    }

    res.status(200).json({
      success: true,
      data: {
        name: user.adminProfile.fullName,
        email: user.email ?? '',
        phone: user.mobile ?? '',
        role: user.role,
        location: user.adminProfile.location ?? '',
        joinedAt: (user as any).createdAt ?? new Date().toISOString(),
        initials: user.adminProfile.fullName
          .split(' ')
          .map((n: string) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2),
      }
    });
  } catch (error) {
    next(error);
  }
};

export const createCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fullName, email, mobile, password, vehicle, groupId, address } = req.body;
    if (!fullName) return res.status(400).json({ success: false, message: 'Full name is required' });

    if (email || mobile) {
      const existing = await prisma.user.findFirst({
        where: { OR: [...(email ? [{ email }] : []), ...(mobile ? [{ mobile }] : [])] }
      });
      if (existing) return res.status(409).json({ success: false, message: 'User already exists' });
    }

    const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;
    
    const customer = await prisma.user.create({
      data: {
        email, mobile, password: hashedPassword, role: 'CUSTOMER',
        customerProfile: { create: { fullName, vehicle, groupId, address } }
      },
      include: { customerProfile: { include: { group: true } } }
    });
    res.status(201).json({ success: true, data: customer.customerProfile });
  } catch (error) { next(error); }
};

export const updateCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { fullName, email, mobile, password, vehicle, groupId, address, status } = req.body;

    const profile = await prisma.customerProfile.findUnique({ where: { id } });
    if (!profile) return res.status(404).json({ success: false, message: 'Customer not found' });

    const hashedPassword = password ? await bcrypt.hash(password, 10) : undefined;
    const updated = await prisma.customerProfile.update({
      where: { id },
      data: {
        fullName, vehicle, groupId, address,
        user: { update: { email, mobile, ...(hashedPassword && { password: hashedPassword }), ...(status && { status: status as any }) } }
      },
      include: { user: true, group: true }
    });
    res.status(200).json({ success: true, data: updated });
  } catch (error) { next(error); }
};

export const deleteCustomer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const profile = await prisma.customerProfile.findUnique({ where: { id } });
    if (!profile) return res.status(404).json({ success: false, message: 'Customer not found' });
    await prisma.$transaction([
      prisma.customerProfile.delete({ where: { id } }),
      prisma.user.delete({ where: { id: profile.userId } })
    ]);
    res.status(200).json({ success: true, message: 'Customer deleted' });
  } catch (error) { next(error); }
};

export const createGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, discountPercent, description, isDefault } = req.body;
    const group = await prisma.group.create({ data: { name, discountPercent, description, isDefault } });
    res.status(201).json({ success: true, data: group });
  } catch (error) { next(error); }
};

export const updateGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { name, discountPercent, description, isDefault, active } = req.body;
    const group = await prisma.group.update({
      where: { id }, data: { name, discountPercent, description, isDefault, active }
    });
    res.status(200).json({ success: true, data: group });
  } catch (error) { next(error); }
};

export const toggleGroupActive = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
    const updated = await prisma.group.update({ where: { id }, data: { active: !group.active } });
    res.status(200).json({ success: true, data: updated });
  } catch (error) { next(error); }
};

export const deleteGroup = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    await prisma.group.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Group deleted' });
  } catch (error) { next(error); }
};

export const markNotificationRead = async (req: any, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const userId = req.user?.userId;
    // ensure notification belongs to user or is global
    const notif = await prisma.notification.findUnique({ where: { id } });
    if (!notif) return res.status(404).json({ success: false, message: 'Notification not found' });
    if (notif.userId && notif.userId !== userId) return res.status(403).json({ success: false, message: 'Unauthorized' });

    const updated = await prisma.notification.update({ where: { id }, data: { read: true } });
    res.status(200).json({ success: true, data: updated });
  } catch (error) { next(error); }
};

export const markAllNotificationsRead = async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.user?.userId;
    // update all for this user, OR global if allowed, but safest is to scope to user
    await prisma.notification.updateMany({ 
      where: { OR: [{ userId }, { userId: null }] }, 
      data: { read: true } 
    });
    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (error) { next(error); }
};
