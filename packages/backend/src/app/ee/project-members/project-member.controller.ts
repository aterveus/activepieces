import { ListProjectMembersRequestQuery, AcceptProjectResponse, AddProjectMemberRequestBody, ProjectMember, ProjectMemberStatus } from '@activepieces/ee-shared'
import { ActivepiecesError, ErrorCode, assertNotNullOrUndefined, isNil } from '@activepieces/shared'
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import { StatusCodes } from 'http-status-codes'
import { logger } from '../../helper/logger'
import { userService } from '../../user/user-service'
import { projectMemberService } from './project-member.service'
import { platformMustBeOwnedByCurrentUser } from '../authentication/ee-authorization'
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { platformService } from '../platform/platform.service'

const DEFAULT_LIMIT_SIZE = 10

export const projectMemberController: FastifyPluginAsyncTypebox = async (app) => {
    app.get('/', ListProjectMembersRequestQueryOptions, async (request) => {
        return projectMemberService.list(
            request.principal.projectId,
            request.query.cursor ?? null,
            request.query.limit ?? DEFAULT_LIMIT_SIZE,
        )
    })

    app.post('/', AddProjectMemberRequest, async (request, reply) => {
        const { status } = request.body
        if (status === ProjectMemberStatus.ACTIVE) {
            await assertFeatureIsEnabled(app, request, reply)
        }
        const { projectMember } = await projectMemberService.upsertAndSend({
            ...request.body,
            projectId: request.principal.projectId,
            platformId: request.principal.platform?.id ?? null,
        })

        await reply.status(StatusCodes.CREATED).send(projectMember)
    })

    app.post('/accept', AcceptProjectMemberRequest, async (request, reply) => {
        try {
            const projectMember = await projectMemberService.accept({
                invitationToken: request.body.token,
            })

            const user = await userService.getByPlatformAndEmail({
                email: projectMember.email,
                platformId: request.principal.platform?.id ?? null,
            })

            return {
                registered: !isNil(user),
            }
        }
        catch (e) {
            logger.error(e)
            return reply.status(StatusCodes.UNAUTHORIZED).send()
        }
    })

    app.delete('/:id', DeleteProjectMemberRequest, async (request) => {
        await projectMemberService.delete(
            request.principal.projectId,
            request.params.id,
        )
    })

    app.delete('/', DeleteProjectMemberByUserExternalIdRequest, async (request, response) => {
        await platformMustBeOwnedByCurrentUser.call(app, request, response)

        const projectId = request.principal.projectId
        const platformId = request.principal.platform?.id
        const userExternalId = request.query.userExternalId

        assertNotNullOrUndefined(platformId, 'platformId')

        await projectMemberService.deleteByUserExternalId({
            userExternalId,
            platformId,
            projectId,
        })
        await response.status(StatusCodes.NO_CONTENT).send()
    })
}

async function assertFeatureIsEnabled(app: FastifyInstance, request: FastifyRequest, reply: FastifyReply) {
    await platformMustBeOwnedByCurrentUser.call(app, request, reply)
    const platformId = request.principal.platform?.id
    assertNotNullOrUndefined(platformId, 'platformId')
    const platform = await platformService.getOneOrThrow(platformId)
    // TODO CHECK WITH BUSINESS LOGIC
    if (!platform.embeddingEnabled) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {},
        })
    }
}

const ListProjectMembersRequestQueryOptions = {
    schema: {
        querystring: ListProjectMembersRequestQuery,
    },
}

const AddProjectMemberRequest = {
    schema: {
        tags: ['project-members'],
        body: AddProjectMemberRequestBody,
        response: {
            [StatusCodes.CREATED]: ProjectMember,
        },
    },
}

const AcceptProjectMemberRequest = {
    schema: {
        body: Type.Object({
            token: Type.String(),
        }),
        response: {
            [StatusCodes.OK]: AcceptProjectResponse,
        },
    },
}

const DeleteProjectMemberRequest = {
    schema: {
        params: Type.Object({
            id: Type.String(),
        }),
    },
}

const DeleteProjectMemberByUserExternalIdRequest = {
    schema: {
        tags: ['project-members'],
        response: {
            [StatusCodes.NO_CONTENT]: Type.Undefined(),
        },
        querystring: Type.Object({
            userExternalId: Type.String(),
        }),
    },
}
