import { Encryption, Prisma } from "@prisma/client";
import {
  InviteCodeNotFoundError,
  UserEmailConflictError,
  UserEmailBadError,
  UserNameConflictError,
  UserNameBadError,
  UserPasswordBadError,
} from "../../class/error/error";
import { Sha256Password } from "../../class/password/sha256";
import { UserValidator } from "./validator/user";
import {
  InternalServerError,
  UserNotFoundError,
  UserPasswordError,
} from "../../class/error/error";
import { User } from "@prisma/client";
import { TokenPayload } from "../token/manager";
import { encryptedPasswordFactory } from "../password/interface";

export class UserManager {
  /**
   * 当前主要使用的密码加密方法
   */
  private static readonly encryptMethod = Encryption.Sha256;

  /**
   * 注册新用户
   * @param email
   * @param name
   * @param password
   * @param inviteCode
   * @returns 创建完成的 User Prisma 对象
   */
  static async register(
    email: string,
    name: string,
    password: string,
    inviteCode: string
  ) {
    if (!UserValidator.isEmail(email))
      throw new UserEmailBadError("邮箱不合法");
    if (!UserValidator.isVaildName(name))
      throw new UserNameBadError("用户名不能为空或过长");
    if (!UserValidator.isSecurePassword(password))
      throw new UserPasswordBadError("密码至少包含字母, 且长度为 7-64");
    if (!inviteCode) throw new InviteCodeNotFoundError("邀请码不存在");

    // 密码加密
    const encryptedPassword = encryptedPasswordFactory(this.encryptMethod);
    encryptedPassword.setSalt(encryptedPassword.generateNewSalt(), password);

    try {
      const create = await usePrisma.user.create({
        data: {
          email,
          name,
          password: encryptedPassword.stringify(),
          inviteBy: {
            connect: {
              code: inviteCode,
              usedBy: null,
              OR: [
                {
                  expiredAt: {
                    gt: new Date(),
                  },
                },
                {
                  expiredAt: null,
                },
              ],
            },
          },
        },
        include: {
          inviteBy: true,
        },
      });

      return create;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          if (error.meta?.target === "User_email_key") {
            throw new UserEmailConflictError("邮箱已被注册");
          }
          if (error.meta?.target === "User_name_key") {
            throw new UserNameConflictError("用户名已被使用");
          }
        }
        if (error.code === "P2025") {
          throw new InviteCodeNotFoundError("邀请码无效");
        }
      }
      throw error;
    }
  }

  /**
   * 登录用户
   * @param account 邮箱或用户名
   * @param password 明文密码
   * @returns 返回一个 JWT Token
   */
  static async login(account: string, password: string) {
    try {
      let user = await usePrisma.user.findFirst({
        where: {
          OR: [{ email: account }, { name: account }],
        },
      });
      if (user === null) throw new UserNotFoundError("无法找到此用户");

      let encryptedPassword = encryptedPasswordFactory(user.encryption);
      encryptedPassword.parse(user.password);
      if (encryptedPassword.testPassword(password)) {
        return <LoginSuccessResult>{
          token: useAuth.sign(<TokenPayload>{
            id: user.id,
          }),
          user,
        };
      } else {
        throw new UserPasswordError("密码错误");
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * 更改用户密码
   */
  static async changePassword(userId: number, newPassword: string) {
    if (UserValidator.isSecurePassword(newPassword) === false) {
      throw new UserPasswordBadError("密码至少包含字母, 且长度为 7-64");
    }

    const encryptedPassword = encryptedPasswordFactory(this.encryptMethod);
    encryptedPassword.setSalt(encryptedPassword.generateNewSalt(), newPassword);

    try {
      await usePrisma.user.update({
        where: {
          id: userId,
        },
        data: {
          encryption: "Sha256",
          password: encryptedPassword.stringify(),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2025") {
          throw new UserNotFoundError("找不到用户");
        }
      }
    }
  }
}

export type LoginSuccessResult = {
  token: string;
  user: User;
};