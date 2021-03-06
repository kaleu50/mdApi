import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from 'nestjs-typegoose';
import { PostM } from './posts.model';
import { ReturnModelType } from '@typegoose/typegoose';
import { User } from '../users/users.model';
import { imageFileFilter } from 'src/utils/file-uploading.utils';
import * as fs from 'fs';
import { baseUrl } from 'src/constants';
import { Comment } from '../comments/comments.model';
import { Like } from 'src/likes/likes.model';

@Injectable()
export class PostsService {

  constructor(
    @InjectModel(PostM) private readonly postModel: ReturnModelType<typeof PostM>,
    @InjectModel(User) private readonly userModel: ReturnModelType<typeof User>,
    @InjectModel(Comment) private readonly commentModel: ReturnModelType<typeof Comment>,
    @InjectModel(Like) private readonly likeModel: ReturnModelType<typeof Like>
  ) {}

  compare(a,b) {
    if (a.createdAt > b.createdAt)
       return -1;
    if (a.createdAt < b.createdAt)
      return 1;
    return 0;
  }

  async createPost(createPost): Promise<PostM> {
    const createdPost = new this.postModel(createPost);
    const savedPost = await createdPost.save()  
    await this.userModel.findOneAndUpdate({ _id: createPost.userId }, { $push: { posts: savedPost._id }}, { new: true });
    if(createPost.imageBase64){
    this.saveImagePost(createPost,  createdPost.id);
    }
    return savedPost;
  }

  async saveImagePost(createdPost, postId) {
    let base64Image = createdPost.imageBase64.split(';base64,').pop();
    let type = createdPost.imageBase64.split('image/').pop().split(';')[0];
    let newFileName = `${postId}.${type}`;
    if (imageFileFilter(type)) {
      const file = await fs.writeFile('./files/' + newFileName, base64Image, { encoding: 'base64' }, function (err) {
      });
      const url = `${baseUrl}/users/files/${newFileName}`;
      this.updateRefPostPic(url, postId);
    }
    else {
      throw new BadRequestException("Tipo de arquivo não suportado");
    }
  }
  
  async updateRefPostPic(url, idPost) {
    await this.postModel.findOneAndUpdate({ _id: idPost }, { refpostpic: url });
    return;
  }

  async findPost(postId){
    return await this.postModel.findOne({_id: postId})
  }

  async findAllPostsbyId(userIdparam: string, logedUserData): Promise<PostM[]>{
    var allPosts = []
    allPosts = await this.postModel.find({userId: userIdparam}).lean().exec();
    var i
    for(i=0;i < allPosts.length;i++){
      console.log(i)
      if(await this.likeModel.find( { $and: [ {userId: logedUserData.id }, { post: allPosts[i]._id }]}).countDocuments() > 0){
        allPosts[i].liked = true
      }
      if(await this.likeModel.find( { $and: [ {userId: logedUserData.id }, { post: allPosts[i]._id }]}).countDocuments() == 0){
        allPosts[i].liked = false
      }
    }
    return allPosts;
  }

  async findPostsFeed(logedUserData, pageNumber, pageSize){
    var allIdPosts = [];
    var allPosts = [];
    const completeUserData = await this.userModel.findOne({_id: logedUserData.id });
    console.log(completeUserData.name);
    await Promise.all(completeUserData.follow.map(async (followedUser)=>{
      const completeFollowedUser = await this.userModel.findOne({_id: followedUser }).exec();
      allIdPosts.push(...completeFollowedUser.posts);
    }))
    await Promise.all(allIdPosts.map(async (postId)=>{
      const completePost = await this.postModel.findOne({_id: postId }).lean().exec();
      if(completePost!=null)
      allPosts.push(completePost);
    }))
    await Promise.all(completeUserData.posts.map(async (selfPostId)=>{
      const selfPost = await this.postModel.findOne({_id: selfPostId }).lean().exec();
      allPosts.push(selfPost);
    }))
    var i
    for(i=0;i < allPosts.length;i++){
      if(await this.likeModel.find( { $and: [ {userId: completeUserData.id }, { post: allPosts[i]._id }]}).countDocuments() > 0){
        allPosts[i].liked = true
      }
      if(await this.likeModel.find( { $and: [ {userId: completeUserData.id }, { post: allPosts[i]._id }]}).countDocuments() == 0){
        allPosts[i].liked = false
      }
    }
    const stopPoint = pageNumber * pageSize
    allPosts.sort(this.compare);
    return allPosts.slice(stopPoint, stopPoint + pageSize);
  }

  async deletePostsById(logedUserData, postId): Promise<boolean> {
    const completePost = await this.postModel.findOne({_id: postId }).exec();
    if(completePost.userId == logedUserData.id){
      await this.postModel.findOneAndDelete({_id: postId }).exec();
      await this.userModel.findOneAndUpdate({ _id: completePost.userId }, { $pull: { posts: postId } });
      await this.commentModel.deleteMany({post: postId});
      await this.likeModel.deleteMany({post: postId});
      return true
    }
    throw new UnauthorizedException("Só o dono do post pode deletar o post");
  }
}